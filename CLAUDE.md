# NEST（塾管理システム）

## ヘルプを同じPRで直す

機能を**足した・変えた・消した**ときは、同じPRの中で `src/lib/help/faqData.ts` のFAQも直す。

FAQは画面の説明であると同時に、**AIヘルプ（`/api/ai/help`）が答えを作る唯一の材料**でもある。
書き漏らせばAIは「載っていません」と黙り、実装と違うことが書いてあれば、それを疑わずに
自信たっぷりに間違いを案内する。**間違ったヘルプは、無いヘルプより悪い。**

★`faqData.ts` を編集する前に **[docs/help-authoring-guide.md](docs/help-authoring-guide.md)** を読む。
どのフィールドに何を書くか、まだ公開しない機能の扱い（`roles` で隠さない）、
出す前のチェックリストがそこにある。

編集したら:

```bash
npx vitest run src/__tests__/lib/faqIndex.test.ts
```
