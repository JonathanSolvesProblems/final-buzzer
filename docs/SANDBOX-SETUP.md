# PayPal sandbox setup, about ten minutes

Everything the agent pays is sandbox test money. These steps create the accounts and the app it
needs. Nothing here touches a real PayPal balance.

## 1. The association's account and the app

1. Sign in at https://developer.paypal.com/dashboard/ with your PayPal login.
2. Testing Tools, Sandbox Accounts, Create account:
   - Type **Business**, country **Canada**, email like `northside-business@example.com`.
   - Under advanced options set the **balance to 25000** and the currency to CAD. The replay pays
     88 games at $115 each, $10,120, and the default $5,000 USD account runs dry.
3. Apps & Credentials, make sure the toggle says **Sandbox**, then **Create App**:
   - Name: Final Buzzer. Type: Merchant. Sandbox business account: the one you just made.
   - On the app page, under **Features**, tick **Payouts**. Without it every payout answers
     "not authorized".
   - Copy **Client ID** and **Secret** into `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.

## 2. Three officials who can receive money

Payouts to an address with no account are held by PayPal as "unclaimed" and still count as sent,
so the replay runs without this step. To watch the money land, create three **Personal** sandbox
accounts (Canada, any balance) and put their emails in `.env`:

```
OFFICIAL_A_EMAIL=...
OFFICIAL_B_EMAIL=...
OFFICIAL_C_EMAIL=...
```

Officials A, B and C are on game 17 (Saturday 9:00, Gym EF) and several others, so the first game
of the replay pays them. You can log in to each one at https://www.sandbox.paypal.com with the
password the dashboard shows, and the payout appears in Activity.

## 3. Run the first game

```
copy .env.example .env      (fill it in)
node src/cli/build-sheet.ts
node --env-file=.env src/cli/live.ts --game 17
```

A good run prints the agent's steps, the decision, and the line

```
Game 17, Bayview v Highland, Gym EF: paid $115.00 to 3 officials, N s after the buzzer (PayPal batch ..., SUCCESS)
```

and writes `results/first-live-run.json`. The batch id in it can be looked up in the dashboard
under the business account's Activity.

## If something refuses

- `PayPal refused the payout for lack of permission`: Payouts is not ticked on the app.
- `balance cannot cover this payout`: raise the business account's balance in Sandbox Accounts.
- `PayPal rejected the payout request: ... currency`: the business account has no CAD balance and
  conversion is off; set `PAYOUT_CURRENCY=USD` in `.env` for the sandbox run and say so in the
  write-up.
