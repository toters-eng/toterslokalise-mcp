import { describe, expect, it } from 'vitest';
import { DEFAULT_API_ORIGIN, resolveApiOrigin } from '../src/config.js';

describe('resolveApiOrigin', () => {
  it('defaults to the production API when TOTERSLOKALISE_API_ORIGIN is unset or blank', () => {
    expect(DEFAULT_API_ORIGIN).toBe('https://arcade.stage.toters-api.com/toters-lokalise');
    expect(resolveApiOrigin({})).toBe('https://arcade.stage.toters-api.com/toters-lokalise');
    expect(resolveApiOrigin({ TOTERSLOKALISE_API_ORIGIN: '   ' })).toBe(
      DEFAULT_API_ORIGIN,
    );
  });

  it('keeps local and staging overrides, trimming and stripping trailing slashes', () => {
    expect(
      resolveApiOrigin({ TOTERSLOKALISE_API_ORIGIN: 'http://localhost:3001' }),
    ).toBe('http://localhost:3001');
    expect(
      resolveApiOrigin({
        TOTERSLOKALISE_API_ORIGIN: 'https://staging.api.toterslokalise.me/',
      }),
    ).toBe('https://staging.api.toterslokalise.me');
    expect(
      resolveApiOrigin({
        TOTERSLOKALISE_API_ORIGIN: '  https://staging.toterslokalise.me  ',
      }),
    ).toBe('https://staging.toterslokalise.me');
  });

  it('rejects malformed and non-http origins instead of failing at request time', () => {
    expect(() =>
      resolveApiOrigin({ TOTERSLOKALISE_API_ORIGIN: 'not a url' }),
    ).toThrowError(/absolute http\(s\) URL/u);
    expect(() =>
      resolveApiOrigin({ TOTERSLOKALISE_API_ORIGIN: 'ftp://toterslokalise.me' }),
    ).toThrowError(/must use http or https/u);
  });
});
