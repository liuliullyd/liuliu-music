declare const __dirname: string;
const { readFileSync } = require('fs');
const { join } = require('path');
const vm = require('vm');
const { Buffer } = require('buffer');
const { TextDecoder } = require('util');
export {};

const runtime = readFileSync(
  join(
    __dirname,
    '..',
    'android/app/src/main/java/com/com.liuliu.agentmusic/SourceScriptRuntime.kt',
  ),
  'utf8',
);

type CapturedRequest = { id: string; url: string; optionsJson: string };

export function createRuntime(debug = false) {
  const marker = 'private fun bootstrap(): String = """';
  const start = runtime.indexOf(marker);
  const end = runtime.indexOf('  """.trimIndent()', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const bootstrap = runtime
    .slice(start + marker.length, end)
    .replaceAll('${BuildConfig.DEBUG}', String(debug))
    .replaceAll('${TRANSPORT_TYPE_KEY}', '__liuliuTransportType')
    .replaceAll('${TRANSPORT_DATA_KEY}', 'data')
    .replaceAll('${TRANSPORT_BYTES}', 'bytes')
    .replaceAll('${MAX_RESPONSE_BYTES}', String(10 * 1024 * 1024))
    .replaceAll('${HTTP_CHUNK_BYTES}', String(64 * 1024))
    .replace(
      '${scriptInfo()}',
      JSON.stringify({ name: 'fixture', rawScript: '' }),
    )
    .replace('${JSONObject.quote(script)}', JSON.stringify(''));
  const requests: CapturedRequest[] = [];
  const forwardedLog = jest.fn();
  const forwardedWarn = jest.fn();
  const cancelled: string[] = [];
  let context: Record<string, any>;
  const bridge = {
    base64Decode(value: string) {
      return JSON.stringify([...Buffer.from(value, 'base64')]);
    },
    base64Encode(valueJson: string) {
      return Buffer.from(JSON.parse(valueJson)).toString('base64');
    },
    http(id: string, url: string, optionsJson: string) {
      requests.push({ id, url, optionsJson });
    },
    cancelHttp(id: string) {
      cancelled.push(id);
    },
    initialized() {},
    rejected(message: string) {
      throw new Error(message);
    },
    md5() {
      return '';
    },
  };
  context = vm.createContext({
    ArrayBuffer,
    Uint8Array,
    TextDecoder,
    URL,
    URLSearchParams,
    atob: (value: string) => Buffer.from(value, 'base64').toString('latin1'),
    Promise,
    console: { ...console, log: forwardedLog, warn: forwardedWarn },
    setTimeout,
    clearTimeout,
    LiuliuSource: bridge,
  });
  context.window = context;
  context.globalThis = context;
  new vm.Script(bootstrap).runInContext(context);
  return { context, requests, cancelled, forwardedLog, forwardedWarn };
}

test('Release suppresses imported script logs while retaining backend protocol parsing', () => {
  const { context, forwardedLog, forwardedWarn } = createRuntime();
  context.__liuliuActiveSource = 'kg';
  context.console.log('[kg] 尝试后端: fixture ID: private');
  context.console.warn('https://private.example/?token=secret');
  expect(context.__liuliuCurrentBackend).toBe('fixture');
  expect(context.__liuliuBackendProtocolSeen).toBe(true);
  expect(forwardedLog).not.toHaveBeenCalled();
  expect(forwardedWarn).not.toHaveBeenCalled();
});

test('Debug retains imported script console forwarding', () => {
  const { context, forwardedLog } = createRuntime(true);
  context.console.log('debug fixture');
  expect(forwardedLog).toHaveBeenCalledWith('debug fixture');
});

test('qishui backend binding uses the shared protocol while Release keeps script logs private', () => {
  const { context, forwardedLog } = createRuntime();
  context.__liuliuActiveSource = 'qs';
  context.console.log('[qs] 尝试后端: 现有音源测试后端');
  context.console.log('[qs] 现有音源测试后端 成功');
  expect(context.__liuliuCurrentBackend).toBe('现有音源测试后端');
  expect(context.__liuliuLastBackend).toBe('现有音源测试后端');
  expect(context.__liuliuBackendProtocolSeen).toBe(true);
  expect(forwardedLog).not.toHaveBeenCalled();
});

test.each([
  ['128k', '128k'], ['标清', '128k'], ['320k', '320k'], ['高清', '320k'],
  ['flac', 'flac'], ['无损', 'flac'], ['flac24bit', 'flac24bit'], ['至臻', 'flac24bit'],
  ['hires', 'hires'], ['母带', 'hires'], [undefined, undefined], ['SQ', undefined],
])('response quality %s is captured independently of the requested tier', (raw, expected) => {
  const { context, requests } = createRuntime();
  context.lx.request('https://resolver.test/url?quality=hires', {}, () => {});
  const req = requests[0]!;
  const body = JSON.stringify({ data: { url: 'https://cdn.test/selected', quality: raw }, other: { url: 'https://cdn.test/other', quality: '320k' } });
  context.__liuliuHttpStart(req.id, JSON.stringify({ statusCode: 200, headers: {}, request: { url: req.url } }));
  context.__liuliuHttpData(req.id, Buffer.from(body).toString('base64'), body);
  context.__liuliuHttpEnd(req.id, Buffer.byteLength(body));
  const result = context.__liuliuResolvedEndpoints('https://cdn.test/selected');
  expect(result[0].responseQuality).toBe(expected);
  // Request quality remains available for the original backend routing contract.
  expect(result[0].quality).toBe('hires');
});

test('responses bind each URL to its own tier, including missing request quality and conflicting results', () => {
  const { context, requests } = createRuntime();
  context.lx.request('https://resolver.test/url', {}, () => {});
  const req = requests[0]!;
  const body = JSON.stringify({ data: [{ url: 'https://cdn.test/first', quality: '无损' }, { url: 'https://cdn.test/second', quality: '母带' }, { url: 'https://cdn.test/conflict', quality: 'flac' }, { url: 'https://cdn.test/conflict', quality: 'hires' }] });
  context.__liuliuHttpStart(req.id, JSON.stringify({ statusCode: 200, headers: {}, request: { url: req.url } }));
  context.__liuliuHttpData(req.id, Buffer.from(body).toString('base64'), body);
  context.__liuliuHttpEnd(req.id, Buffer.byteLength(body));
  expect(context.__liuliuResolvedEndpoints('https://cdn.test/first')[0].responseQuality).toBe('flac');
  expect(context.__liuliuResolvedEndpoints('https://cdn.test/second')[0].responseQuality).toBe('hires');
  expect(context.__liuliuResolvedEndpoints('https://cdn.test/conflict')[0].responseQuality).toBeUndefined();
});

test('an invalid child tier cannot inherit a parent tier or the request tier', () => {
  const { context, requests } = createRuntime();
  context.lx.request('https://resolver.test/url?quality=hires', {}, () => {});
  const req = requests[0]!;
  const body = JSON.stringify({ quality: '母带', data: { url: 'https://cdn.test/selected', quality: 'unknown' } });
  context.__liuliuHttpStart(req.id, JSON.stringify({ statusCode: 200, headers: {}, request: { url: req.url } }));
  context.__liuliuHttpData(req.id, Buffer.from(body).toString('base64'), body);
  context.__liuliuHttpEnd(req.id, Buffer.byteLength(body));
  expect(context.__liuliuResolvedEndpoints('https://cdn.test/selected')[0].responseQuality).toBeUndefined();
});

test('LX request preserves typed byte bodies in a source-neutral transport envelope', () => {
  const { context, requests } = createRuntime();
  vm.runInContext(
    `lx.request('https://source.invalid/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: lx.utils.buffer.from('00ff61', 'hex'),
      formData: {
        file: {
          filename: 'fixture.bin',
          contentType: 'application/octet-stream',
          data: lx.utils.buffer.from('AQID', 'base64'),
        },
      },
      timeout: 4321,
    }, () => {})`,
    context,
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://source.invalid/url');
  expect(JSON.parse(requests[0]!.optionsJson)).toEqual({
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: { __liuliuTransportType: 'bytes', data: 'AP9h' },
    formData: {
      file: {
        filename: 'fixture.bin',
        contentType: 'application/octet-stream',
        data: { __liuliuTransportType: 'bytes', data: 'AQID' },
      },
    },
    timeout: 4321,
  });
});

test('a bound interface can return audio through a request alias, and unbound discovery still starts with Hi-Res', async () => {
  const { context, requests } = createRuntime();
  context.__liuliuMusicInfo = { songmid: 'target' };
  context.__liuliuActiveQuality = 'hires';
  context.__liuliuBoundedRequests = true;
  // Same behavior as Hello World 260925: per-interface maps inside a serial
  // per-quality fallback. No private source credentials are part of the fixture.
  vm.runInContext(`
    globalThis.fixtureResolve = async () => {
      for (const quality of ['hires', 'flac24bit', 'flac', '320k', '128k']) {
        for (const api of [
          { url: 'https://resolver.test/128-only', qualities: ['128k','320k','flac','flac24bit'] },
          { url: 'https://resolver.test/hires', qualities: ['128k','320k','flac','hires'] },
        ]) {
          if (!api.qualities.includes(quality)) continue;
          try { return await new Promise((resolve,reject) => lx.request(api.url+'?id=target&quality='+quality, {},
            (error,_response,body) => error ? reject(error) : resolve(body.url))); }
          catch (_error) {}
        }
      }
      throw new Error('所有API均失败');
    };
  `, context);
  context.__liuliuPinnedBackendRoutes = [context.__liuliuRequestRoute('https://resolver.test/128-only?id=sample&quality=128k')];
  const pinned = context.fixtureResolve();
  await new Promise<void>(resolve => setTimeout(resolve, 1));
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toContain('/128-only?id=target&quality=flac24bit');
  const pinnedBody = JSON.stringify({ url: 'https://cdn.test/actual-master.flac' });
  context.__liuliuHttpStart(requests[0]!.id, JSON.stringify({ statusCode: 200, headers: {}, request: { url: requests[0]!.url } }));
  context.__liuliuHttpData(requests[0]!.id, Buffer.from(pinnedBody).toString('base64'), pinnedBody);
  context.__liuliuHttpEnd(requests[0]!.id, Buffer.byteLength(pinnedBody));
  await expect(pinned).resolves.toBe('https://cdn.test/actual-master.flac');
  expect(context.__liuliuResolvedEndpoints('https://cdn.test/actual-master.flac')[0].quality).toBe('flac24bit');
  requests.length = 0;
  context.__liuliuPinnedBackendRoutes = [];
  const pending = context.fixtureResolve();
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toContain('/hires?id=target&quality=hires');
  const body = JSON.stringify({ url: 'https://cdn.test/hires.flac' });
  context.__liuliuHttpStart(requests[0]!.id, JSON.stringify({ statusCode: 200, headers: {}, request: { url: requests[0]!.url } }));
  context.__liuliuHttpData(requests[0]!.id, Buffer.from(body).toString('base64'), body);
  context.__liuliuHttpEnd(requests[0]!.id, Buffer.byteLength(body));
  await expect(pending).resolves.toBe('https://cdn.test/hires.flac');
  expect(context.__liuliuResolvedEndpoints('https://cdn.test/hires.flac')[0].quality).toBe('hires');
});

test('LX request supports ArrayBuffer, UTF-8 and cancellation without source-specific branches', () => {
  const { context, requests, cancelled } = createRuntime();
  vm.runInContext(
    `globalThis.cancelFixture = lx.request('https://source.invalid/url', {
      method: 'POST',
      body: lx.utils.buffer.from('中文🎵', 'utf8').buffer,
    }, () => {})`,
    context,
  );
  const encoded = JSON.parse(requests[0]!.optionsJson).body;
  expect(encoded).toEqual({
    __liuliuTransportType: 'bytes',
    data: Buffer.from('中文🎵', 'utf8').toString('base64'),
  });
  vm.runInContext('cancelFixture()', context);
  expect(cancelled).toEqual([requests[0]!.id]);
});

test('LX response decodes JSON and retains the exact original bytes', () => {
  const { context, requests } = createRuntime();
  context.capture = jest.fn();
  vm.runInContext(
    `lx.request('https://source.invalid/url', {}, (error, response, body) => capture(error, response, body))`,
    context,
  );
  const bodyText = JSON.stringify({ url: 'https://audio.invalid/song.mp3' });
  context.__liuliuHttpStart(
    requests[0]!.id,
    JSON.stringify({
      statusCode: 201,
      statusMessage: 'Created',
      headers: { 'content-type': 'application/json' },
    }),
  );
  context.__liuliuHttpData(
    requests[0]!.id,
    Buffer.from(bodyText).toString('base64'),
    bodyText,
  );
  context.__liuliuHttpEnd(requests[0]!.id, Buffer.byteLength(bodyText));
  const [error, response, body] = context.capture.mock.calls[0]!;
  expect(error).toBeNull();
  expect(body).toEqual({ url: 'https://audio.invalid/song.mp3' });
  expect(response.body).toEqual(body);
  expect(response.bodyText).toBe(bodyText);
  expect([...response.raw]).toEqual([...Buffer.from(bodyText)]);
});

test('binary LX responses remain bytes and are never JSON-decoded', () => {
  const { context, requests } = createRuntime();
  context.capture = jest.fn();
  vm.runInContext(
    `lx.request('https://source.invalid/url', { binary: true }, (error, response, body) => capture(error, response, body))`,
    context,
  );
  const bytes = Buffer.from('{"looks":"json"}\u0000', 'utf8');
  context.__liuliuHttpStart(
    requests[0]!.id,
    JSON.stringify({
      statusCode: 200,
      statusMessage: 'OK',
      headers: {},
    }),
  );
  context.__liuliuHttpData(requests[0]!.id, bytes.toString('base64'), '');
  context.__liuliuHttpEnd(requests[0]!.id, bytes.length);
  const [, response, body] = context.capture.mock.calls[0]!;
  expect(body).toBeInstanceOf(Uint8Array);
  expect([...body]).toEqual([...bytes]);
  expect([...response.raw]).toEqual([...bytes]);
  expect(response.bodyText).toBe('');
});

test('native transport decodes byte bodies and multipart file descriptors', () => {
  expect(runtime).toContain(
    'private fun transportBytes(value: Any?): ByteArray?',
  );
  expect(runtime).toContain('options.has("body") -> encodeBody(');
  expect(runtime).toContain('bytes.toRequestBody(mediaType)');
  expect(runtime).not.toContain(
    'LiuliuSource.http(id, String(url), JSON.stringify(options || {}))',
  );
});

test.each([undefined, 'registered-backend'])(
  'captures the successful resolver endpoint with optional label %s',
  backend => {
    const { context, requests } = createRuntime();
    context.__liuliuCurrentBackend = backend ?? '';
    vm.runInContext(
      `lx.request('https://resolver.test/request', {}, () => {})`,
      context,
    );
    context.__liuliuHttpStart(
      requests[0]!.id,
      JSON.stringify({
        statusCode: 200,
        headers: {},
        request: { url: 'https://resolver.test/final?signature=per-request' },
      }),
    );
    const body = '{"url":"https://cdn.test/audio.mp3"}';
    context.__liuliuHttpData(
      requests[0]!.id,
      Buffer.from(body).toString('base64'),
      body,
    );
    context.__liuliuHttpEnd(requests[0]!.id, Buffer.byteLength(body));
    expect(context.__liuliuResolvedEndpoints('https://cdn.test/audio.mp3', backend ?? '')).toEqual([
      {
        ...(backend ? { backend } : {}),
        url: 'https://resolver.test/final?signature=per-request',
        requestRoute: JSON.stringify([
          'GET',
          'https://resolver.test',
          '/request',
          [],
        ]),
      },
    ]);
    expect(runtime).toContain('it.request.url.toString()');
  },
);

test('an unlabeled captured interface admits the next song request and skips other backend interfaces', async () => {
  const { context, requests } = createRuntime();
  context.__liuliuMusicInfo = { songmid: 'first' };
  context.__liuliuActiveQuality = '128k';
  const route = context.__liuliuRequestRoute(
    'https://resolver.test/music/first?id=first&sign=old',
  );
  context.__liuliuPinnedBackendRoutes = [route];
  context.__liuliuMusicInfo = { songmid: 'second' };
  context.capture = jest.fn();
  vm.runInContext(
    `
    lx.request('https://slow.test/music/second?id=second&sign=new', {}, capture);
    lx.request('https://resolver.test/music/second?id=second&sign=new', {}, capture);
  `,
    context,
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe(
    'https://resolver.test/music/second?id=second&sign=new',
  );
  await new Promise<void>(resolve => setTimeout(() => resolve(), 1));
  expect(context.capture.mock.calls[0]![0].message).toBe(
    '已跳过未绑定接口的音源后端',
  );
});

test('same-host GET and POST backend selectors stay distinct while song IDs and signatures stay reusable', () => {
  const { context } = createRuntime();
  context.__liuliuMusicInfo = { songmid: 'first' };
  const first = context.__liuliuRequestRoute('https://resolver.test/url?line=passing&id=first&sign=old&quality=128k');
  const post = context.__liuliuRequestRoute('https://resolver.test/url', { method: 'POST', body: JSON.stringify({ backend: 'passing', id: 'first', quality: '128k' }) });
  context.__liuliuMusicInfo = { songmid: 'second' };
  expect(context.__liuliuRequestRoute('https://resolver.test/url?line=passing&id=second&sign=new&quality=hires')).toBe(first);
  expect(context.__liuliuRequestRoute('https://resolver.test/url?line=slow&id=second&sign=new&quality=hires')).not.toBe(first);
  expect(context.__liuliuRequestRoute('https://resolver.test/url', { method: 'POST', body: JSON.stringify({ quality: 'hires', id: 'second', backend: 'passing' }) })).toBe(post);
  expect(context.__liuliuRequestRoute('https://resolver.test/url', { method: 'POST', body: JSON.stringify({ backend: 'slow', id: 'second', quality: 'hires' }) })).not.toBe(post);
});

test.each(['wy', 'tx', 'kg', 'kw', 'mg'])('%s type quality aliases reuse the bound interface without merging backend selectors', async platform => {
  const { context, requests } = createRuntime();
  context.__liuliuMusicInfo = { songmid: 'startup-song' };
  const route = context.__liuliuRequestRoute(`https://resolver.test/url?source=${platform}&id=startup-song&type=128`);
  context.__liuliuPinnedBackendRoutes = [route];
  context.__liuliuMusicInfo = { songmid: 'selected-song' };
  context.capture = jest.fn();
  const target = `https://resolver.test/url?source=${platform}&id=selected-song&type=320`;
  context.lx.request(target, {}, context.capture);
  expect(requests.map(request => request.url)).toEqual([target]);
  expect(context.__liuliuRequestRoute(`https://resolver.test/url?source=${platform}&id=other&type=flac`)).toBe(route);
  expect(context.__liuliuRequestRoute(`https://resolver.test/url?source=${platform}&id=other&type=json`)).not.toBe(route);
  expect(context.__liuliuRequestRoute(`https://resolver.test/url?source=other&id=other&type=320`)).not.toBe(route);
  await new Promise<void>(resolve => setTimeout(resolve, 1));
  expect(context.capture).not.toHaveBeenCalled();
});

test.each(['wy', 'tx', 'kg', 'kw', 'mg'])('%s session user changes keep the captured interface but not a different backend', async platform => {
  const { context, requests } = createRuntime();
  const route = (user: string, line = 'passing') => context.__liuliuRequestRoute(
    `https://resolver.test/url?source=${platform}&id=track&user=${user}&line=${line}`,
  );
  context.__liuliuPinnedBackendRoutes = [route('startup-session')];
  context.capture = jest.fn();
  const target = `https://resolver.test/url?source=${platform}&id=selected&user=current-session&line=passing`;
  context.lx.request(target, {}, context.capture);
  expect(requests.map(request => request.url)).toEqual([target]);
  expect(route('other-session')).toBe(route('startup-session'));
  expect(route('other-session', 'other')).not.toBe(route('startup-session'));
  const bodyRoute = (user: string, backend = 'passing') => context.__liuliuRequestRoute('https://resolver.test/url', {
    method: 'POST', body: { data: { user }, backend, source: platform },
  });
  expect(bodyRoute('current-session')).toBe(bodyRoute('startup-session'));
  expect(bodyRoute('current-session', 'other')).not.toBe(bodyRoute('startup-session'));
  context.__liuliuMusicInfo = { albumId: '0' };
  const sharedValueRoute = route('0');
  context.__liuliuMusicInfo = { albumId: 'selected-album' };
  expect(route('0')).toBe(sharedValueRoute);
  await new Promise<void>(resolve => setTimeout(resolve, 1));
  expect(context.capture).not.toHaveBeenCalled();
});

test('type request quality aliases in nested JSON and forms stay separate from literal response format selectors', () => {
  const { context } = createRuntime();
  const route = (type: string, backend = 'passing') => context.__liuliuRequestRoute('https://resolver.test/url', {
    method: 'POST', body: { backend, data: { type, id: 'track' } },
  });
  expect(route('320k')).toBe(route('128k'));
  expect(route('hires')).toBe(route('128k'));
  expect(route('json')).not.toBe(route('xml'));
  expect(route('320k', 'other')).not.toBe(route('128k'));
});

test.each(['wy', 'tx', 'kg', 'kw', 'mg'])('%s nested arrays normalize current track identities and keep static RPC selectors', platform => {
  const { context } = createRuntime();
  const body = (id: string, backend = 'passing') => ({ method: 'GetSongUrl', module: platform,
    params: { songmid: [id], data: [{ value: id, quality: ['128k'] }], backend } });
  context.__liuliuMusicInfo = { songmid: 'sample' };
  const route = context.__liuliuRequestRoute('https://resolver.test/rpc', { method: 'POST', body: body('sample') });
  context.__liuliuMusicInfo = { songmid: 'selected' };
  expect(context.__liuliuRequestRoute('https://resolver.test/rpc', { method: 'POST', body: body('selected') })).toBe(route);
  expect(context.__liuliuRequestRoute('https://resolver.test/rpc', { method: 'POST', body: body('selected', 'other') })).not.toBe(route);
});

test('lower interfaces are excluded for this request while encrypted payload changes keep one backend identity', async () => {
  const { context, requests } = createRuntime();
  const options = { method: 'POST', form: { params: 'encrypted-first', encSecKey: 'key-first', line: 'fast' } };
  const route = context.__liuliuRequestRoute('https://resolver.test/url', options);
  expect(context.__liuliuRequestRoute('https://resolver.test/url', { method: 'POST', form: { params: 'encrypted-second', encSecKey: 'key-second', line: 'fast' } })).toBe(route);
  expect(context.__liuliuRequestRoute('https://resolver.test/url', { method: 'POST', form: { params: 'encrypted-second', encSecKey: 'key-second', line: 'other' } })).not.toBe(route);
  context.__liuliuRejectedBackendRoutes = new Set([route]);
  context.capture = jest.fn();
  context.lx.request('https://resolver.test/url', options, context.capture);
  context.lx.request('https://resolver.test/master', {}, context.capture);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://resolver.test/master');
  await new Promise<void>(resolve => setTimeout(resolve, 1));
  expect(context.capture.mock.calls[0][0].message).toContain('较低真实音质');
  context.__liuliuRejectedBackendRoutes = new Set();
  context.lx.request('https://resolver.test/url', options, context.capture);
  expect(requests).toHaveLength(2);
});

test('request tier names cannot reject an audio URL before native classification; deadlines remain bounded outside startup', async () => {
  const { context, requests } = createRuntime();
  context.__liuliuActiveQuality = 'hires';
  context.__liuliuBoundedRequests = true;
  context.capture = jest.fn();
  vm.runInContext(`
    lx.request('https://resolver.test/url?quality=flac24bit', {}, capture);
    lx.request('https://resolver.test/url?quality=flac', {}, capture);
    lx.request('https://resolver.test/url?quality=hires', {}, capture);
  `, context);
  expect(requests).toHaveLength(3);
  expect(requests.map(request => JSON.parse(request.optionsJson).timeout)).toEqual([10000, 10000, 10000]);
  await new Promise<void>(resolve => setTimeout(resolve, 1));
  expect(context.capture).not.toHaveBeenCalled();
  context.__liuliuBoundedRequests = false;
  vm.runInContext(`lx.request('https://resolver.test/url?quality=128k', {}, capture)`, context);
  expect(JSON.parse(requests[3]!.optionsJson).timeout).toBeUndefined();
});

test('only the final returned audio URL identifies a successful interface, including parallel source responses', () => {
  const { context, requests } = createRuntime();
  for (const [path, quality] of [['loser', 'flac'], ['winner', 'hires']]) {
    context.lx.request(`https://resolver.test/${path}?quality=${quality}`, {}, () => {});
    const request = requests[requests.length - 1]!;
    const body = JSON.stringify({ data: { url: `https://cdn.test/${path}` } });
    context.__liuliuHttpStart(request.id, JSON.stringify({ statusCode: 200, request: { url: request.url }, headers: {} }));
    context.__liuliuHttpData(request.id, Buffer.from(body).toString('base64'), body);
    context.__liuliuHttpEnd(request.id, Buffer.byteLength(body));
  }
  const selected = context.__liuliuResolvedEndpoints('https://cdn.test/winner');
  expect(selected).toHaveLength(1);
  expect(selected[0].quality).toBe('hires');
  expect(selected[0].url).toContain('/winner?');
  expect(selected[0].responseUrls).toBeUndefined();
  expect(context.__liuliuResolvedEndpoints('https://cdn.test/unknown')).toEqual([]);
});

function deliverSourceResponse(host: ReturnType<typeof createRuntime>, endpoint: string, body: unknown) {
  host.context.lx.request(endpoint, {}, () => {});
  const request = host.requests[host.requests.length - 1]!;
  const text = JSON.stringify(body);
  host.context.__liuliuHttpStart(request.id, JSON.stringify({
    statusCode: 200, request: { url: request.url }, headers: {},
  }));
  host.context.__liuliuHttpData(request.id, Buffer.from(text).toString('base64'), text);
  host.context.__liuliuHttpEnd(request.id, Buffer.byteLength(text));
}

test('script-appended query keys retain the unique interface without borrowing another URL audio tier', () => {
  const host = createRuntime();
  const original = 'https://cdn.test/stream.php?u=original#part';
  deliverSourceResponse(host, 'https://resolver.test/url?quality=128k', {
    data: { url: original, quality: '高清' },
  });
  const selected = host.context.__liuliuResolvedEndpoints(original.replace('#part', '&key=fixture#part'));
  expect(selected).toHaveLength(1);
  expect(selected[0].url).toBe('https://resolver.test/url?quality=128k');
  expect(selected[0].requestRoute).toBeDefined();
  expect(selected[0].quality).toBe('128k');
  expect(selected[0].responseQuality).toBeUndefined();
  expect(selected[0].responseUrls).toBeUndefined();
  expect(host.context.__liuliuResolvedEndpoints(original)[0].responseQuality).toBe('320k');
  expect(host.requests).toHaveLength(1);
});

test.each([
  ['https://cdn.test/stream.php', 'https://cdn.test/stream.php?key=fixture'],
  ['https://cdn.test/stream.php?u=one&u=two', 'https://cdn.test/stream.php?u=one&u=two&key=fixture'],
])('query append preserves valid original parameters: %s', (original, selected) => {
  const host = createRuntime();
  deliverSourceResponse(host, 'https://resolver.test/url', { url: original });
  expect(host.context.__liuliuResolvedEndpoints(selected)).toHaveLength(1);
});

test.each([
  'https://cdn.test/stream.php?u=changed&key=fixture',
  'https://cdn.test/stream.php?key=fixture',
  'https://cdn.test/stream.php?u=original&u=changed&key=fixture',
  'https://cdn.test/stream.php?u=original&key=one&key=two',
  'https://other.test/stream.php?u=original&key=fixture',
  'http://cdn.test/stream.php?u=original&key=fixture',
  'https://cdn.test:444/stream.php?u=original&key=fixture',
  'https://cdn.test/other.php?u=original&key=fixture',
  'https://user:password@cdn.test/stream.php?u=original&key=fixture',
  'https://cdn.test/stream.php?u=original&key=fixture#changed',
])('URL changes beyond a unique query append cannot claim an interface: %s', selected => {
  const host = createRuntime();
  deliverSourceResponse(host, 'https://resolver.test/url', { url: 'https://cdn.test/stream.php?u=original' });
  expect(host.context.__liuliuResolvedEndpoints(selected)).toEqual([]);
});

test('derived URL attribution rejects competing interfaces and gives exact matches priority', () => {
  const host = createRuntime();
  const original = 'https://cdn.test/stream.php?u=original';
  const selected = `${original}&key=fixture`;
  deliverSourceResponse(host, 'https://resolver.test/one', { url: original });
  deliverSourceResponse(host, 'https://resolver.test/two', { url: original });
  expect(host.context.__liuliuResolvedEndpoints(selected)).toEqual([]);
  deliverSourceResponse(host, 'https://resolver.test/exact', { url: selected, quality: '无损' });
  const result = host.context.__liuliuResolvedEndpoints(selected);
  expect(result).toHaveLength(1);
  expect(result[0].url).toBe('https://resolver.test/exact');
  expect(result[0].responseQuality).toBe('flac');
});

test('query append attribution retains backend selection and no-URL responses cannot win', () => {
  const host = createRuntime();
  const original = 'https://cdn.test/stream.php?u=original';
  host.context.__liuliuCurrentBackend = 'first';
  deliverSourceResponse(host, 'https://resolver.test/first', { url: original });
  host.context.__liuliuCurrentBackend = 'second';
  deliverSourceResponse(host, 'https://resolver.test/second', { url: original });
  host.context.__liuliuCurrentBackend = '';
  deliverSourceResponse(host, 'https://resolver.test/metadata', { message: 'no url' });
  const result = host.context.__liuliuResolvedEndpoints(`${original}&key=fixture`, 'first');
  expect(result).toHaveLength(1);
  expect(result[0].backend).toBe('first');
  expect(result[0].dependencyRoutes).toHaveLength(1);
  expect(host.context.__liuliuResolvedEndpoints('https://unknown.test/audio?key=fixture')).toEqual([]);
});

test('per-song interval changes keep the same pinned interface and preserve the wire request', async () => {
  const host = createRuntime();
  host.context.__liuliuMusicInfo = { songmid: 'first', interval: '04:02' };
  const first = 'https://resolver.test/url?source=qs&songmid=first&interval=04%3A02&quality=128k';
  const route = host.context.__liuliuRequestRoute(first);
  host.context.__liuliuPinnedBackendRoutes = [route];
  host.context.__liuliuMusicInfo = { songmid: 'second', interval: '03:32' };
  const next = 'https://resolver.test/url?source=qs&songmid=second&interval=03%3A32&quality=128k';
  const callback = jest.fn();
  host.context.lx.request(next, {}, callback);
  await new Promise<void>(resolve => setTimeout(resolve, 1));
  expect(callback).not.toHaveBeenCalled();
  expect(host.requests).toHaveLength(1);
  expect(host.requests[0].url).toBe(next);
  expect(host.context.__liuliuRequestRoute(next)).toBe(route);
  expect(host.context.__liuliuRequestRoute(next.replace('03%3A32', '09%3A00'))).not.toBe(route);
  expect(host.context.__liuliuRequestRoute(next.replace('source=qs', 'source=kg'))).not.toBe(route);
  expect(host.context.__liuliuRequestRoute(next + '&timeout=10')).not.toBe(route);
});

test('source request diagnostics identify the script without exposing script text or URLs', () => {
  expect(runtime).toContain('scriptSha=${scriptDigest(script)}');
});

test('address cancellation removes only its queued request or active runtime and acknowledges cleanup', () => {
  const module = readFileSync(
    join(
      __dirname,
      '..',
      'android/app/src/main/java/com/com.liuliu.agentmusic/LiuliuStorageModule.kt',
    ),
    'utf8',
  );
  expect(module).toContain('fun resolveSourceScriptAddress(');
  expect(module).toContain(
    'fun cancelSourceScriptAddress(requestId: String, promise: Promise)',
  );
  expect(runtime).toContain('val addressRequestId: String? = null');
  expect(runtime).toContain('request.addressRequestId == requestId');
  expect(runtime).toContain('session.active?.addressRequestId == requestId');
  expect(runtime).toContain('"SOURCE_ADDRESS_ABORTED"');
  expect(module).not.toContain('fun getSourceBackendPool(');
  expect(module).not.toContain('fun rememberSourceBackendHint(');
  expect(module).toContain(
    'key.startsWith("source_backend_hint_") || key.startsWith("source_backend_pool_")',
  );
});
