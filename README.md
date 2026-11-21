# みんなのチャット

合言葉 + ニックネームで入れる、友達用チャット(テキスト・画像対応)。外部パッケージ不要、Node.js 18以降で動きます。

## 自分のPCで試す

```
CHAT_PASSWORD=好きな合言葉 node server.js
```

→ http://localhost:3000 を開く。(Windows PowerShell: `$env:CHAT_PASSWORD="合言葉"; node server.js`)

## 独自URLで公開する(Render の例)

1. このフォルダ(server.js / index.html / package.json)を GitHub のリポジトリにアップロード
2. https://render.com で「New → Web Service」→ そのリポジトリを選ぶ
3. 設定:
   - Build Command: (空欄でOK)
   - Start Command: `node server.js`
   - Environment Variables: `CHAT_PASSWORD` = 合言葉
   - 履歴を再起動後も残したい場合: Disk を追加(Mount Path `/data`)し、環境変数 `DATA_DIR` = `/data`
4. 公開されると `https://あなたの名前.onrender.com` というURLになります。友達にURLと合言葉を教えるだけ。

### 好きなドメイン(例: chat.example.com)にしたい場合
ドメインを購入し、Render の Settings → Custom Domains に追加、表示されるDNS設定(CNAME)をドメイン側に登録します。

※ Railway / Fly.io / VPS でも同じ要領で動きます(`node server.js` と `CHAT_PASSWORD` だけ必要)。
※ 無料プランはしばらく使わないとスリープし、最初のアクセスが遅くなることがあります。また無料プランはDiskがないため、再起動で履歴と画像が消えます。

## 仕様
- 入室時にニックネームと合言葉を入力(名前は端末に保存され、次回から自動入室)
- 合言葉を間違え続けると一時的にロック(IPごとに15分で10回)
- 直近500件のメッセージを保持(古い画像は自動削除)
- 画像は1280pxに縮小して送信、貼り付け(ペースト)にも対応
- 注意: ニックネームは自己申告です(なりすまし可能)。合言葉を知っている人だけが入れます。
