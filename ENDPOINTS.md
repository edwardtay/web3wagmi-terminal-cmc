# Every CoinMarketCap endpoint this app calls

A real request and a real response for each, captured against a live key on the **free Basic
tier** on 20 and 21 September 2026. Nothing here is from the documentation.

The key travels on the `X-CMC_PRO_API_KEY` header and never in a URL, which is why every URL below
is safe to print. Responses are trimmed to one array element and the first few fields; the shapes
are exact.

Costs are taken from `status.credit_count` in the response envelope rather than from the pricing
page, which does not price the derivatives or key endpoints at all. The one exception is the
keyless mirror, which reports 1 and charges 0; see item 9 of [FEEDBACK.md](FEEDBACK.md).

This list is exactly the endpoints the code calls. Nothing is listed here that the app does not
use, and nothing the app uses is missing.

| Endpoint | Credits billed | Used by |
| --- | --- | --- |
| `/v5/derivatives/liquidations/quotes/latest` | 1 | `/api/forced`, the headline figure |
| `/v5/derivatives/liquidations/exchange/list/latest` | 1 | `/api/forced`, the sampler, and the live call on `/cmc`. The whole project rests on this one |
| `/v5/derivatives/liquidations/cryptocurrency/list/latest` | 1 | `/api/forced`, `/api/leverage` and the sampler |
| `/v5/cryptocurrency/derivatives/market-pairs/list/latest` | 1 | `/api/leverage`, the denominator |
| `/public-api/v1/global-metrics/quotes/latest` | 0 (envelope says 1) | `/api/volume` and the sampler |
| `/v1/key/info` | 0 | `/cmc`, the evidence page |

## `/v5/derivatives/liquidations/quotes/latest`

Market-wide liquidation totals over rolling 1h, 4h and 24h.

**Request**

```bash
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  'https://pro-api.coinmarketcap.com/v5/derivatives/liquidations/quotes/latest'
```

**Response** (HTTP 200, 3ms, 1 credit billed)

```json
{
  "status": {
    "timestamp": "2026-09-20T15:59:41.647Z",
    "error_code": "0",
    "error_message": "",
    "elapsed": 3,
    "credit_count": 1
  },
  "data": {
    "quotes": [
      {
        "symbol": "USD",
        "crypto_id": 2781,
        "total_liquidations_1h": 11023278.265693806,
        "long_liquidations_1h": 962241.5794785243,
        "short_liquidations_1h": 10061036.686215281,
        "total_liquidations_4h": 23415805.130321667,
        "long_liquidations_4h": 7113152.324633286,
        "short_liquidations_4h": 16302652.80568838
      }
    ]
  }
}
```

## `/v5/derivatives/liquidations/exchange/list/latest`

The same, split by venue. Returns exactly nine and is not paginated.

**Request**

```bash
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  'https://pro-api.coinmarketcap.com/v5/derivatives/liquidations/exchange/list/latest'
```

**Response** (HTTP 200, 4ms, 1 credit billed)

```json
{
  "status": {
    "timestamp": "2026-09-20T15:59:43.237Z",
    "error_code": "0",
    "error_message": "",
    "elapsed": 4,
    "credit_count": 1
  },
  "data": {
    "exchanges": [
      {
        "name": "Binance",
        "slug": "binance",
        "quotes": [
          {
            "symbol": "USD",
            "crypto_id": 2781,
            "total_liquidations_1h": 4493134.84354566,
            "long_liquidations_1h": 480187.77197215,
            "short_liquidations_1h": 4012947.07157351,
            "total_liquidations_4h": 10492253.84084982,
            "long_liquidations_4h": 3910427.88646283,
            "short_liquidations_4h": 6581825.95438699
          }
        ],
        "exchange_id": 270
      },
      "... 9 items"
    ],
    "total_size": 9,
    "has_more": false
  }
}
```

## `/v5/derivatives/liquidations/cryptocurrency/list/latest`

The same, split by coin. 100 rows of 918, paged with `start`.

**Request**

```bash
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  'https://pro-api.coinmarketcap.com/v5/derivatives/liquidations/cryptocurrency/list/latest'
```

**Response** (HTTP 200, 8ms, 1 credit billed)

```json
{
  "status": {
    "timestamp": "2026-09-20T15:59:44.901Z",
    "error_code": "0",
    "error_message": "",
    "elapsed": 8,
    "credit_count": 1
  },
  "data": {
    "cryptocurrencies": [
      {
        "name": "Bitcoin",
        "symbol": "BTC",
        "slug": "bitcoin",
        "quotes": [
          {
            "symbol": "USD",
            "crypto_id": 2781,
            "total_liquidations_1h": 2393637.92995,
            "long_liquidations_1h": 38519.15755,
            "short_liquidations_1h": 2355118.7724,
            "total_liquidations_4h": 3552330.88071,
            "long_liquidations_4h": 102363.21975,
            "short_liquidations_4h": 3449967.66096
          }
        ],
        "crypto_id": 1,
        "cmc_rank": 1
      },
      "... 100 items"
    ],
    "total_size": 918,
    "has_more": true
  }
}
```

## `/v5/cryptocurrency/derivatives/market-pairs/list/latest`

Every venue's market pairs for one coin, each carrying `open_interest`, `funding_rate` and the outlier flags.

The funding rate is only under `exchange_reported_quotes`, as a fraction per settlement period with
no period given. The response below is truncated to one pair and omits that block.

**Request**

```bash
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  'https://pro-api.coinmarketcap.com/v5/cryptocurrency/derivatives/market-pairs/list/latest?crypto_symbol=BTC'
```

**Response** (HTTP 200, 39ms, 1 credit billed)

```json
{
  "status": {
    "timestamp": "2026-09-20T16:00:56.030Z",
    "error_code": "0",
    "error_message": "",
    "elapsed": 39,
    "credit_count": 1
  },
  "data": {
    "crypto_id": 1,
    "crypto_name": "Bitcoin",
    "symbol": "BTC",
    "num_market_pairs": 195,
    "market_pairs": [
      {
        "market_id": 979173,
        "market_pair_symbol": "BTC/USDT",
        "category": "perpetual",
        "fee_type": "percentage",
        "outlier_detected": false,
        "exclusions": [
          "price",
          "... 2 items"
        ],
        "exchange": {
          "exchange_id": 21,
          "exchange_name": "BTCC",
          "exchange_slug": "btcc"
        },
        "market_pair_base": {
          "crypto_id": 1,
          "symbol": "BTC",
          "exchange_symbol": "BTC",
          "currency_type": "cryptocurrency"
        }
      },
      "... 100 items"
    ]
  }
}
```

## `/public-api/v1/global-metrics/quotes/latest`

Adjusted volume beside reported volume, per slice. Served by the keyless mirror at `/public-api`.

**Request**

```bash
curl 'https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest'
```

**Response** (HTTP 200, 2ms, 0 credit billed)

```json
{
  "status": {
    "timestamp": "2026-09-20T20:52:23.795Z",
    "error_code": 0,
    "error_message": null,
    "elapsed": 2,
    "credit_count": 1,
    "notice": null
  },
  "data": {
    "quote": {
      "USD": {
        "total_market_cap": 2780238147970.215,
        "total_volume_24h": 70426557779.8,
        "total_volume_24h_reported": 438864499973.07,
        "altcoin_volume_24h": 49119448931.188156,
        "altcoin_volume_24h_reported": 316050559965.5809,
        "altcoin_market_cap": 1150616899693.3262,
        "defi_volume_24h": 11344772605.760176,
        "defi_market_cap": 85556699320.3527
      }
    },
    "btc_dominance": 58.614448171162,
    "eth_dominance": 11.576492797429,
    "active_cryptocurrencies": 8160,
    "total_cryptocurrencies": 39716,
    "active_market_pairs": 114497,
    "active_exchanges": 978,
    "total_exchanges": 12948
  }
}
```

## `/v1/key/info`

Plan limits and live credit usage. Free.

**Request**

```bash
curl -H "X-CMC_PRO_API_KEY: $CMC_API_KEY" \
  'https://pro-api.coinmarketcap.com/v1/key/info'
```

**Response** (HTTP 200, 3ms, 0 credit billed)

```json
{
  "status": {
    "timestamp": "2026-09-20T16:00:08.082Z",
    "error_code": 0,
    "error_message": null,
    "elapsed": 3,
    "credit_count": 0,
    "notice": null
  },
  "data": {
    "plan": {
      "credit_limit_monthly": 15000,
      "credit_limit_monthly_reset": "In 10 days, 7 hours, 59 minutes",
      "credit_limit_monthly_reset_timestamp": "2026-10-01T00:00:00.000Z",
      "rate_limit_minute": 50
    },
    "usage": {
      "current_minute": {
        "requests_made": 6,
        "requests_left": 44
      },
      "current_day": {
        "credits_used": 10
      },
      "current_month": {
        "credits_used": 10,
        "credits_left": 14990
      }
    }
  }
}
```
