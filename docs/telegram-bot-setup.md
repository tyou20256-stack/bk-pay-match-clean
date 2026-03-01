# Telegram Bot Setup — BK Pay

Configured via Telegram Bot API on 2026-03-01.

## Bot Name
`BK Pay 暗号通貨購入`

## Commands
| Command | Description |
|---------|-------------|
| /buy | USDT/BTC/ETHを購入する |
| /rates | 現在のレートを確認 |
| /status | 注文の状況を確認 |
| /history | 過去の注文履歴 |
| /calc | 金額シミュレーション |
| /alert | レートアラート設定 |
| /wallet | ウォレットアドレス確認 |
| /help | 使い方ガイド |

## Description
> BK Pay — 日本円でUSDT・BTC・ETHを簡単購入。P2P取引所の最安レートで自動マッチング。24時間対応。

## Short Description
> 日本円→暗号通貨の即時購入サービス

## Menu Button
- Type: `web_app`
- Text: `BK Pay`
- URL: `https://debi-unominous-overcasually.ngrok-free.dev/miniapp.html`

## API Calls Used
- `setMyCommands` — Bot command menu
- `setMyDescription` — Bot profile description
- `setMyShortDescription` — Short bio
- `setChatMenuButton` — Mini App menu button
- `setMyName` — Display name
