export const LABELS = { name: '名前', email: 'メールアドレス', message: '本文' } as const;
export type Field = keyof typeof LABELS;

export const missingText = (fields: Field[]) => fields.map((f) => LABELS[f]).join('、');

export type ResultName = 'sent' | 'invalid' | 'rejected' | 'limited' | 'failed';

// interface は暗黙の index signature を持たず、Astro の getStaticPaths の props に渡せない
type Message = {
  heading: string;
  body: string[];
  missing?: string;
  requestId?: string;
  page?: string;
  inline?: string;
};

// 表示の順序は body → missing → requestId → page(入力画面では page の代わりに inline)
export const RESULTS: Record<ResultName, Message> = {
  sent: { heading: '送信した', body: ['お問い合わせを送信した。返信が必要な内容には、入力されたメールアドレスへ返信する。'] },
  invalid: {
    heading: '送信できなかった',
    body: [],
    missing: '次の項目が未入力か、形式・長さが正しくない: ',
    page: 'ブラウザーの戻る操作で入力画面へ戻り、直してから送信してほしい。',
    inline: '直してから、もう一度送信してほしい。',
  },
  rejected: {
    heading: '送信を確認できなかった',
    body: [],
    page: 'お問い合わせのページを再読み込みしてから、もう一度送信してほしい。',
    inline: '送信ボタンの上の確認が終わってから、もう一度送信してほしい。',
  },
  limited: { heading: '送信が多すぎる', body: ['1 分ほど待ってから、もう一度送信してほしい。'] },
  failed: {
    heading: '送信に失敗した',
    body: ['送信できなかった。内容は保存していないので、時間をおいて再度送信してほしい。'],
    requestId: '識別番号: ',
  },
};
