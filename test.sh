#!/bin/bash
URL="https://asripay-snap.alam-sutera.com/payment-links/payment/create/no_snap"
API_KEY="077da272-4f69-4dae-a355-fccd43dcee1b"
echo "Starting parallel requests at $(date +%T.%N)"
for i in {1..3}; do
  (
    RESPONSE=$(curl -s -X POST "$URL" \
      -H "API-KEY: $API_KEY" \
      -F "IDX_M_Company=2" \
      -F "TransactionAmount=1" \
      -F 'CustomerJson={"customerName":"FUTOPIA - TESTING","customerPhoneNumber":"-","customerEmail":"-","customerAddress":"-"}' \
      -F 'ProductJson=[{"id":"1","name":"AQUA","qty":1,"price":"1","subtotal":"1"}]' \
      -F "IDX_M_MerchantSnap=807" \
      -F "IDX_M_PaymentMethod=2" \
      -F "SuccessURL=http://localhost/SportsCenterPadi_WEB/payment/success" \
      -F "FailedURL=http://localhost/SportsCenterPadi_WEB/payment/failed" \
      -F "CallbackURL=http://localhost/SportsCenterPadi_WEB/payment/callback" \
      -w "\n[HTTP %{http_code}] [%{time_total}s]")
    echo "=== Request $i ==="
    echo "$RESPONSE"
    echo ""
  ) &
done
wait
echo "All requests done at $(date +%T.%N)"
