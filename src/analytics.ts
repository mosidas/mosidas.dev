// Base.astro がページごとに呼ぶため、warn をビルドで 1 回に抑える
let warned = false;

export function beaconToken(token: string | undefined, ci: boolean): string | undefined {
  if (token) {
    if (!/^[\w-]{1,64}$/.test(token)) throw new Error('PUBLIC_WEB_ANALYTICS_TOKEN の形式が不正');
    return token;
  }
  // 本番のビルド(Workers Builds)で計測が抜けたまま配信されるのを防ぐ
  if (ci) throw new Error('PUBLIC_WEB_ANALYTICS_TOKEN が未設定');
  if (!warned) {
    warned = true;
    console.warn(
      JSON.stringify({ level: 'warn', msg: 'PUBLIC_WEB_ANALYTICS_TOKEN が未設定のため、Web Analytics の beacon を出力しない' }),
    );
  }
  return undefined;
}
