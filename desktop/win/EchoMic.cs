// The microphone without the call (2026-11-15, Damian: both sides of a call without a headset):
// Windows' own Voice Capture filter (the "AEC DMO", in Windows since Vista, what Skype used) captures
// the default microphone and takes out of it what the default speakers play, the call, even while
// you talk. It hands over 16 kHz 16-bit mono, the format the page sends on; chunks of 100 ms.
using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace TranslateApp
{
    sealed class EchoMic : IDisposable
    {
        const int Rate = 16000, Chunk = 1600;
        readonly Action<byte[]> send;
        readonly Action<EchoMic> lost;
        readonly Thread thread;
        readonly ManualResetEventSlim started = new ManualResetEventSlim();
        volatile bool stop;
        bool ok;

        /// Null when Windows' filter can't run here (no microphone, no speakers, an old Windows).
        public static EchoMic Open(Action<byte[]> send, Action<EchoMic> lost)
        {
            var m = new EchoMic(send, lost);
            m.started.Wait(TimeSpan.FromSeconds(5));
            if (m.ok) return m;
            m.Dispose();
            return null;
        }

        EchoMic(Action<byte[]> send, Action<EchoMic> lost)
        {
            this.send = send;
            this.lost = lost;
            // (COM in its own thread from start to end: the filter lives and works there)
            thread = new Thread(Run) { IsBackground = true, Name = "echo-mic" };
            thread.SetApartmentState(ApartmentState.MTA);
            thread.Start();
        }

        void Run()
        {
            IMediaObject dmo = null;
            var format = IntPtr.Zero;
            var buffer = new MediaBuffer(Rate * 2);
            try
            {
                dmo = (IMediaObject)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("745057c7-f353-4f2d-a7ee-58434477730e")));
                var props = (IPropertyStore)dmo;
                // one microphone, echo cancelling only (SINGLE_CHANNEL_AEC), the default devices
                var mode = new PropertyKey { fmtid = new Guid("6f52c567-0360-4bd2-9617-ccbf1421c939"), pid = 2 };
                var zero = new PropVariant { vt = 3, lVal = 0 };
                Check(props.SetValue(ref mode, ref zero));
                format = Marshal.AllocHGlobal(18);
                byte[] wave = new byte[18];
                BitConverter.GetBytes((short)1).CopyTo(wave, 0); // PCM
                BitConverter.GetBytes((short)1).CopyTo(wave, 2); // mono
                BitConverter.GetBytes(Rate).CopyTo(wave, 4);
                BitConverter.GetBytes(Rate * 2).CopyTo(wave, 8);
                BitConverter.GetBytes((short)2).CopyTo(wave, 12);
                BitConverter.GetBytes((short)16).CopyTo(wave, 14);
                Marshal.Copy(wave, 0, format, 18);
                var type = new DmoMediaType
                {
                    majortype = new Guid("73647561-0000-0010-8000-00aa00389b71"),
                    subtype = new Guid("00000001-0000-0010-8000-00aa00389b71"),
                    bFixedSizeSamples = 1,
                    lSampleSize = 2,
                    formattype = new Guid("05589f81-c356-11ce-bf01-00aa0055595a"),
                    cbFormat = 18,
                    pbFormat = format,
                };
                Check(dmo.SetOutputType(0, ref type, 0));
                Check(dmo.AllocateStreamingResources());
                ok = true;
                started.Set();
                var chunk = new byte[Chunk * 2];
                int filled = 0, fails = 0;
                var unk = Marshal.GetComInterfaceForObject(buffer, typeof(IMediaBuffer));
                try
                {
                    while (!stop)
                    {
                        Thread.Sleep(10);
                        for (;;)
                        {
                            buffer.Length = 0;
                            var outs = new[] { new DmoOutputDataBuffer { pBuffer = unk } };
                            int hr = dmo.ProcessOutput(0, 1, outs, out _);
                            if (hr < 0)
                            {
                                if (++fails > 50) throw new COMException("the filter stopped", hr);
                                break;
                            }
                            fails = 0;
                            for (int at = 0; at < buffer.Length;)
                            {
                                int n = Math.Min(chunk.Length - filled, buffer.Length - at);
                                Marshal.Copy(buffer.Data + at, chunk, filled, n);
                                filled += n;
                                at += n;
                                if (filled == chunk.Length)
                                {
                                    send((byte[])chunk.Clone());
                                    filled = 0;
                                }
                            }
                            if ((outs[0].dwStatus & 0x01000000) == 0) break; // (nothing more waiting)
                        }
                    }
                }
                finally { Marshal.Release(unk); }
            }
            catch (Exception e)
            {
                Program.Note(new Exception("echo mic: " + e, e));
                if (ok && !stop) lost(this);
            }
            finally
            {
                started.Set();
                try { dmo?.FreeStreamingResources(); } catch (Exception) { /* (gone) */ }
                if (dmo != null) Marshal.ReleaseComObject(dmo);
                if (format != IntPtr.Zero) Marshal.FreeHGlobal(format);
                buffer.Dispose();
            }
        }

        static void Check(int hr)
        {
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        }

        public void Dispose()
        {
            stop = true;
            if (Thread.CurrentThread != thread) thread.Join(2000);
        }

        // ---- the COM parts the filter talks through ----

        [StructLayout(LayoutKind.Sequential)]
        struct DmoMediaType
        {
            public Guid majortype, subtype;
            public int bFixedSizeSamples, bTemporalCompression, lSampleSize;
            public Guid formattype;
            public IntPtr pUnk;
            public int cbFormat;
            public IntPtr pbFormat;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct DmoOutputDataBuffer
        {
            public IntPtr pBuffer;
            public int dwStatus;
            public long rtTimestamp, rtTimelength;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct PropertyKey
        {
            public Guid fmtid;
            public int pid;
        }

        [StructLayout(LayoutKind.Explicit, Size = 24)]
        struct PropVariant
        {
            [FieldOffset(0)] public short vt;
            [FieldOffset(8)] public int lVal;
        }

        [ComImport, Guid("d8ad0f58-5494-4102-97c5-ec798e59bcf4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMediaObject
        {
            [PreserveSig] int GetStreamCount(out int inputs, out int outputs);
            [PreserveSig] int GetInputStreamInfo(int i, out int flags);
            [PreserveSig] int GetOutputStreamInfo(int i, out int flags);
            [PreserveSig] int GetInputType(int i, int t, IntPtr mt);
            [PreserveSig] int GetOutputType(int i, int t, IntPtr mt);
            [PreserveSig] int SetInputType(int i, IntPtr mt, int flags);
            [PreserveSig] int SetOutputType(int i, ref DmoMediaType mt, int flags);
            [PreserveSig] int GetInputCurrentType(int i, IntPtr mt);
            [PreserveSig] int GetOutputCurrentType(int i, IntPtr mt);
            [PreserveSig] int GetInputSizeInfo(int i, out int size, out int lookahead, out int align);
            [PreserveSig] int GetOutputSizeInfo(int i, out int size, out int align);
            [PreserveSig] int GetInputMaxLatency(int i, out long latency);
            [PreserveSig] int SetInputMaxLatency(int i, long latency);
            [PreserveSig] int Flush();
            [PreserveSig] int Discontinuity(int i);
            [PreserveSig] int AllocateStreamingResources();
            [PreserveSig] int FreeStreamingResources();
            [PreserveSig] int GetInputStatus(int i, out int flags);
            [PreserveSig] int ProcessInput(int i, IntPtr buffer, int flags, long time, long length);
            [PreserveSig] int ProcessOutput(int flags, int count, [In, Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] DmoOutputDataBuffer[] buffers, out int status);
            [PreserveSig] int Lock(int lockIt);
        }

        [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPropertyStore
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int GetAt(int i, out PropertyKey key);
            [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
            [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
            [PreserveSig] int Commit();
        }

        [ComImport, Guid("59eff8b9-938c-4a26-82f2-95cb84cdc837"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMediaBuffer
        {
            [PreserveSig] int SetLength(int length);
            [PreserveSig] int GetMaxLength(IntPtr max);
            [PreserveSig] int GetBufferAndLength(IntPtr buffer, IntPtr length);
        }

        /// The buffer the filter writes into (our own memory, handed over as a COM object).
        [ComVisible(true)]
        sealed class MediaBuffer : IMediaBuffer, IDisposable
        {
            public readonly IntPtr Data;
            public int Length;
            readonly int max;

            public MediaBuffer(int max)
            {
                this.max = max;
                Data = Marshal.AllocHGlobal(max);
            }

            public int SetLength(int length)
            {
                if (length < 0 || length > max) return unchecked((int)0x80070057); // E_INVALIDARG
                Length = length;
                return 0;
            }

            public int GetMaxLength(IntPtr p)
            {
                if (p != IntPtr.Zero) Marshal.WriteInt32(p, max);
                return 0;
            }

            public int GetBufferAndLength(IntPtr buffer, IntPtr length)
            {
                if (buffer != IntPtr.Zero) Marshal.WriteIntPtr(buffer, Data);
                if (length != IntPtr.Zero) Marshal.WriteInt32(length, Length);
                return 0;
            }

            public void Dispose() => Marshal.FreeHGlobal(Data);
        }
    }
}
