export const LABELS = { name: '名前', email: 'メールアドレス', message: '本文' } as const;
export type Field = keyof typeof LABELS;

export const missingText = (fields: Field[]) => fields.map((f) => LABELS[f]).join('、');

export type ResultName = 'sent' | 'invalid' | 'rejected' | 'limited' | 'failed';

// interface は暗黙の index signature を持たず、Astro の getStaticPaths の props に渡せない
type Message = {
  heading: string;
  body: string[];
  missing?: string;
  page?: string;
  inline?: string;
};

// 表示の順序は body → missing → page(入力画面では page の代わりに inline)
export const RESULTS: Record<ResultName, Message> = {
  sent: {
    heading: '送信しました',
    body: ['お問い合わせを受け付けました。返信が必要な内容には、ご入力いただいたメールアドレスへご連絡します。'],
  },
  invalid: {
    heading: '送信できませんでした',
    body: [],
    missing: '次の項目が未入力か、形式または長さが正しくありません: ',
    page: 'ブラウザーの「戻る」で入力画面に戻り、修正してから再度送信してください。',
    inline: '修正のうえ、再度送信してください。',
  },
  rejected: {
    heading: '送信を確認できませんでした',
    body: [],
    page: 'お問い合わせのページを再読み込みしてから、再度送信してください。',
    inline: '送信ボタンの上の確認をやり直してから、再度送信してください。',
  },
  limited: { heading: '送信回数の上限に達しました', body: ['1 分ほど待ってから、再度送信してください。'] },
  failed: { heading: '送信に失敗しました', body: ['時間をおいて、再度送信してください。'] },
};
