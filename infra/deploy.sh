#!/usr/bin/env bash
# Despliega el portal (web/ → S3 + invalidación de CloudFront) y, con "api", también el código de la Lambda.
#   AWS_PROFILE=didi-tamez bash infra/deploy.sh          # solo portal
#   AWS_PROFILE=didi-tamez bash infra/deploy.sh api      # portal + Lambda
set -euo pipefail
export AWS_PAGER="" MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/outputs.env"

if [ "${1:-}" = "api" ]; then bash "$HERE/setup.sh" >/dev/null && echo "Lambda actualizada"; fi

V=$(date +%Y%m%d%H%M%S)
OUT="$HERE/.build/web"; rm -rf "$OUT"; mkdir -p "$OUT"; cp -r "$HERE/../web/." "$OUT/"
sed -i "s/__V__/$V/g" "$OUT/index.html"
W="$OUT"; command -v cygpath >/dev/null && W="$(cygpath -w "$OUT")"

# html/js/css: no-cache (el navegador revalida con ETag en cada carga → siempre la versión nueva)
# docs/ lo escribe la Lambda (Anexo D subido desde Administración): nunca se toca aquí.
aws s3 sync "$W" "s3://$BUCKET" --delete --exclude "assets/*" --exclude "docs/*" --cache-control "no-cache" --region "$REGION"
# imágenes: caché de 7 días
aws s3 sync "$W/assets" "s3://$BUCKET/assets" --delete --cache-control "public, max-age=604800" --region "$REGION"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" --query Invalidation.Id --output text
echo "Portal publicado: $PORTAL_URL"
