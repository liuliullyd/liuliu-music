/** User-triggered requests only. A deadline covers connection and body reads. */
export async function headphoneRequest<T>(url: string, read: (response: Response) => Promise<T>, signal?: AbortSignal, body?: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const stopped = new Promise<never>((_,reject) => {
    cancel = () => { controller.abort(); reject(new Error('已取消更新，原耳机数据库保留')); };
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort',cancel);
    timer = setTimeout(() => { controller.abort(); reject(new Error('耳机数据请求超时，请重试；原数据库保留')); }, body ? 30000 : 15000);
  });
  try {
    return await Promise.race([stopped,(async () => {
      if (signal?.aborted) throw new Error('已取消更新，原耳机数据库保留');
      const response = await fetch(url,{signal:controller.signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
      if (!response.ok) throw new Error(`耳机数据请求失败（HTTP ${response.status}）；原数据库保留`);
      return read(response);
    })()]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); }
}
export async function latestAutoEqVersion(signal?: AbortSignal) {
  const atom = await headphoneRequest('https://github.com/jaakkopasanen/AutoEq/commits/master.atom',response=>response.text(),signal);
  const sha = atom.match(/Grit::Commit\/([a-f0-9]{40})/)?.[1];
  if (!sha) throw new Error('无法核实官网数据版本，原数据库保留');
  return sha;
}
