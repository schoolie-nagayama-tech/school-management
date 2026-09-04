# ユーザー一覧API: `/api/admin/users`

**パス:** `src/app/api/admin/users/route.ts`  
（`/api/users/route.ts` ではなく `/api/admin/users` です）

## GET の動き

1. **取得元**  
   Supabase の `user_profiles` テーブルを **全件** 取得（`select('*')`）。  
   メールドメイン（@test.com / @aread-company.com）での絞り込みは **一切していません**。

2. **フィルタ**
   - クエリに `?role=teacher` がある → **講師（role=teacher）だけ**返す（講師一覧用）
   - それ以外（ユーザー管理用）→ **講師以外（admin, owner, manager など）** だけ返す

3. **教室情報**  
   各ユーザーごとに `user_schools` を取得して `user_schools` として付与して返す。

## 結論

- **メールアドレスやドメインによるフィルタはありません。**
- 返却対象は「`user_profiles` に 1 行あるユーザー」だけです。  
  → **Auth（auth.users）にいても、`user_profiles` にレコードが無いユーザーは一覧に出ません。**

表示されていない 4 人（y.okamoto@aread-company.com など）は、  
**Supabase の `user_profiles` に該当する行が無い**可能性が高いです。  
（例: 招待以外の方法で作成された、またはプロファイル作成に失敗したケース）

確認手順:

1. Supabase Dashboard → Table Editor → `user_profiles`
2. 上記 4 人のメール（または id）で検索し、行があるか確認する。

行が無い場合は、該当ユーザー用に `user_profiles` に 1 行ずつ挿入するか、  
「招待承諾」や「ユーザー管理の追加」など、プロファイルが必ず作られるフローで作り直す必要があります。
