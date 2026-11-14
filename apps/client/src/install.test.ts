import { describe, expect, it } from 'vitest';
import { installWay } from './install';

const ua = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
};

describe('installing as an app', () => {
  it('how each device installs, and never once installed', () => {
    expect(installWay(ua.iphone, true, false, false)).toBe('iphone');
    expect(installWay(ua.mac, true, false, false)).toBe('ipad'); // (an iPad says it is a Mac)
    expect(installWay(ua.mac, false, false, false)).toBe('menu'); // (Safari's Add to Dock)
    expect(installWay(ua.android, true, false, true)).toBe('prompt');
    expect(installWay(ua.android, true, false, false)).toBe('menu');
    expect(installWay(ua.firefox, false, false, false)).toBeNull();
    expect(installWay(ua.android, true, true, true)).toBeNull();
  });
});
