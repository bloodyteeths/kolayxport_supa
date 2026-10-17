#!/bin/bash
# Creates the KolayXport plan prices (lib/billing/price.ts) and the founding coupon in LIVE Stripe.
# Safe to re-run: every price has a lookup key and is reused when it already exists; the Pro product and
# the coupon are found by metadata before anything is created. Old prices are never changed.
#
#   bash scripts/billing/stripe-setup-live.sh
#
# Prints the server .env lines at the end (they are ids, not secrets).
set -euo pipefail

STARTER=${STARTER:-prod_Shl7a7l3vXvMpJ}   # "Başlangıç" (existing live product)
GROWTH=${GROWTH:-prod_ShlAKBtwxfUDRf}     # "Büyüme" (existing live product)
MODE=${STRIPE_MODE---live}              # STRIPE_MODE= (empty) runs against test mode for a dry run

json() { python3 -c "import sys,json,re; t=re.sub(r'\x1b\[[0-9;]*m','',sys.stdin.read()); i=t.find('{'); d=json.loads(t[i:]); $1"; }

# Pro product: reuse the one tagged app=kolayxport, plan=pro if it exists.
PRO=$(stripe products list $MODE --limit 100 | json "print(next((p['id'] for p in d['data'] if p.get('metadata',{}).get('app')=='kolayxport' and p.get('metadata',{}).get('plan')=='pro'), ''))")
if [ -z "$PRO" ]; then
  PRO=$(stripe products create $MODE --name "Pro" --description "Pro Planı" --tax-code txcd_10103001 \
    -d "metadata[app]=kolayxport" -d "metadata[plan]=pro" | json "print(d['id'])")
  echo "created Pro product $PRO" >&2
fi

OUT=()
price() { # product plan interval currency amount
  local key="kx_${2}_${3}_${4}" id
  id=$(stripe get /v1/prices $MODE -d "lookup_keys[]=$key" -d limit=1 | json "print(d['data'][0]['id'] if d['data'] else '')")
  if [ -z "$id" ]; then
    id=$(stripe prices create $MODE --product "$1" --currency "$4" --unit-amount "$5" -d "recurring[interval]=$3" \
      --lookup-key "$key" -d "nickname=KolayXport $2 $3 $4" -d "tax_behavior=inclusive" \
      -d "metadata[app]=kolayxport" -d "metadata[plan]=$2" | json "print(d['id'])")
    echo "created $key $id" >&2
  else
    echo "exists  $key $id" >&2
  fi
  local P I C; P=$(echo "$2" | tr a-z A-Z); I=$(echo "$3" | tr a-z A-Z); C=$(echo "$4" | tr a-z A-Z)
  OUT+=("PRICE_${P}_${I}_${C}=$id")
  # The TRY price is also the default for the plan/interval.
  [ "$4" = "try" ] && OUT+=("PRICE_${P}_${I}=$id")
  return 0
}

price $STARTER starter month try 249900;  price $STARTER starter year try 2499000
price $STARTER starter month usd 5900;    price $STARTER starter year usd 59000
price $GROWTH  growth  month try 499900;  price $GROWTH  growth  year try 4999000
price $GROWTH  growth  month usd 9900;    price $GROWTH  growth  year usd 99000
price $PRO     pro     month try 799900;  price $PRO     pro     year try 7999000
price $PRO     pro     month usd 14900;   price $PRO     pro     year usd 149000

# Founding coupon: 40% off forever, first 20 subscribers.
COUPON=$(stripe coupons list $MODE --limit 100 | json "print(next((c['id'] for c in d['data'] if c.get('metadata',{}).get('app')=='kolayxport' and c.get('valid')), ''))")
if [ -z "$COUPON" ]; then
  COUPON=$(stripe coupons create $MODE --percent-off 40 --duration forever --max-redemptions 20 \
    --name "Kurucu üye %40" -d "metadata[app]=kolayxport" | json "print(d['id'])")
  echo "created coupon $COUPON" >&2
fi
OUT+=("STRIPE_FOUNDING_COUPON_ID=$COUPON")

echo
echo "# Server .env (/home/deploy/kolayxport/.env):"
printf '%s\n' "${OUT[@]}"
