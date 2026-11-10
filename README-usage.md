# Credits dashboard (all accounts on one page)

Open **http://127.0.0.1:3000/usage** to see one bar for the total of all your Puter accounts and one bar per account.
The same data as JSON: **/usage.json**.

## Set it up

1. Copy `accounts.example.txt` to `accounts.txt` and put one Puter token per line:

   ```
   main: eyJ...first token
   spare: eyJ...second token
   eyJ...third token
   ```

   (`token`, `label token` and `label: token` all work. Lines starting with `#` are ignored.)
   `accounts.txt` is in `.gitignore`, so it will not be pushed to your repo. Never commit tokens.
2. Start the server as usual (`npm start`) and open `/usage`. The file is read on every request,
   so you can add or remove accounts without restarting.

Instead of a file you can set `PUTER_ACCOUNTS` (same entries, separated by commas or new lines).
If nothing is configured, the token sent with the request is used, so a single account works out of the box.

## What the numbers are

Each account's numbers come from Puter's `puter.auth.getMonthlyUsage()`: the monthly allowance and what remains.
Used = allowance - remaining. The total adds up every account that answered; an account that fails (bad token,
Puter down) shows its error on its own row and is left out of the total.

Puter counts in microcents ($0.01 = 1,000,000), so the page shows **US dollars** by default.
If you want the same units as your Puter dashboard's "credits", set `CREDIT_VALUE_MICROCENTS` to the value of one
credit in microcents. For example, if 1 credit = $0.001, use `CREDIT_VALUE_MICROCENTS=100000`.
Then compare one account with its Puter dashboard to check the numbers match.

Bars turn amber at 70% used and red at 90%. Results are cached for 20 seconds, and the page auto-refreshes every
30 seconds (the "Refresh now" button skips the cache).

## Safety

- Tokens never appear in the page or in the JSON. Accounts are shown by label and a 6-character id,
  the same `acct=xxxxxx` id as in the server log.
- Set **`USAGE_KEY=somesecret`** to require `/usage?key=somesecret` (or an `x-usage-key` header). Recommended
  if the server is reachable from other machines. By default the server only listens on 127.0.0.1.
- These routes never send a CORS header, so other websites cannot read your quota.
