#!/usr/bin/env bash
# Crea (o verifica) toda la infraestructura AWS de DIDI_Choferes_Tamez. Es idempotente:
# se puede volver a correr sin duplicar recursos.
#   Uso:  AWS_PROFILE=didi-tamez bash infra/setup.sh
set -euo pipefail
export AWS_PAGER=""
export MSYS_NO_PATHCONV=1   # Git Bash en Windows: no reescribir rutas tipo /aws/...
REGION="${AWS_REGION:-us-east-1}"
PROYECTO="DIDI_Choferes_Tamez"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="didi-choferes-tamez-portal-${ACCOUNT}"   # S3 no permite mayúsculas ni "_"
ROLE="${PROYECTO}_Lambda_Role"
FN="${PROYECTO}_API"
TAGS_KV="Key=Proyecto,Value=${PROYECTO}"
HERE="$(cd "$(dirname "$0")" && pwd)"
log(){ echo -e "\n== $*"; }

# ------------------------------------------------------------------ DynamoDB
crear_tabla(){ # nombre, key-schema, attr-defs, [extra]
  local t="${PROYECTO}_$1"
  if aws dynamodb describe-table --table-name "$t" --region "$REGION" >/dev/null 2>&1; then
    echo "  tabla $t ya existe"; return; fi
  aws dynamodb create-table --region "$REGION" --table-name "$t" --billing-mode PAY_PER_REQUEST \
    --key-schema $2 --attribute-definitions $3 ${4:-} \
    --tags Key=Proyecto,Value=${PROYECTO} Key=Name,Value=$t >/dev/null
  echo "  tabla $t creada"
}
log "DynamoDB (bajo demanda: solo pagas lo que usas)"
crear_tabla Usuarios   "AttributeName=usuario,KeyType=HASH" "AttributeName=usuario,AttributeType=S"
crear_tabla Choferes   "AttributeName=id,KeyType=HASH"      "AttributeName=id,AttributeType=S"
crear_tabla Semanas    "AttributeName=semana,KeyType=HASH AttributeName=id,KeyType=RANGE" \
                       "AttributeName=semana,AttributeType=S AttributeName=id,AttributeType=S"
crear_tabla Plantillas "AttributeName=id,KeyType=HASH"      "AttributeName=id,AttributeType=S"
crear_tabla Config     "AttributeName=clave,KeyType=HASH"   "AttributeName=clave,AttributeType=S"
crear_tabla Seguimiento "AttributeName=id,KeyType=HASH AttributeName=ts,KeyType=RANGE" \
  "AttributeName=id,AttributeType=S AttributeName=ts,AttributeType=S AttributeName=gpk,AttributeType=S" \
  "--global-secondary-indexes IndexName=Feed,KeySchema=[{AttributeName=gpk,KeyType=HASH},{AttributeName=ts,KeyType=RANGE}],Projection={ProjectionType=ALL}"
for t in Usuarios Choferes Semanas Plantillas Config Seguimiento; do
  aws dynamodb wait table-exists --table-name "${PROYECTO}_$t" --region "$REGION"; done
# Respaldo continuo (PITR) en las tablas con trabajo humano: permite restaurar a cualquier punto de los últimos 35 días.
for t in Usuarios Choferes Seguimiento Plantillas; do
  aws dynamodb update-continuous-backups --region "$REGION" --table-name "${PROYECTO}_$t" \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null; done

# ------------------------------------------------------------------ IAM
log "IAM: rol de ejecución de la Lambda con permisos mínimos"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --tags "$TAGS_KV" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  echo "  rol creado"; sleep 10
fi
aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam put-role-policy --role-name "$ROLE" --policy-name "${PROYECTO}_DynamoDB" --policy-document "{
  \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",
  \"Action\":[\"dynamodb:GetItem\",\"dynamodb:PutItem\",\"dynamodb:UpdateItem\",\"dynamodb:DeleteItem\",
              \"dynamodb:Query\",\"dynamodb:Scan\",\"dynamodb:BatchWriteItem\",\"dynamodb:BatchGetItem\"],
  \"Resource\":[\"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${PROYECTO}_*\",
                \"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${PROYECTO}_*/index/*\"]}]}"
ROLE_ARN=$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)

# ------------------------------------------------------------------ Lambda
log "Lambda $FN (Node 22, ARM/Graviton = ~20% más barato)"
mkdir -p "$HERE/.build"; TMPZIP="$HERE/.build/api.zip"; command -v cygpath >/dev/null && TMPZIP="$(cygpath -w "$TMPZIP")"
(cd "$HERE/../backend" && node -e "
const fs=require('fs'),zlib=require('zlib');
// zip mínimo sin dependencias (método store)
const files=['index.mjs','defaults.mjs'];const parts=[],central=[];let off=0;
const crcT=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c;});
const crc=b=>{let c=-1;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return (c^-1)>>>0;};
for(const f of files){const d=fs.readFileSync(f),n=Buffer.from(f),c=crc(d),z=zlib.deflateRawSync(d);
 const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt32LE(c,14);h.writeUInt32LE(z.length,18);h.writeUInt32LE(d.length,22);h.writeUInt16LE(n.length,26);
 parts.push(h,n,z);const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(8,10);ch.writeUInt32LE(c,16);ch.writeUInt32LE(z.length,20);ch.writeUInt32LE(d.length,24);ch.writeUInt16LE(n.length,28);ch.writeUInt32LE(0x81a40000,38);ch.writeUInt32LE(off,42);
 central.push(ch,n);off+=30+n.length+z.length;}
const cd=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(files.length,8);e.writeUInt16LE(files.length,10);e.writeUInt32LE(cd.length,12);e.writeUInt32LE(off,16);
fs.writeFileSync(process.argv[1],Buffer.concat([...parts,cd,e]));" "$TMPZIP")
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --region "$REGION" --zip-file "fileb://$TMPZIP" >/dev/null
  echo "  código actualizado"
else
  for i in 1 2 3 4 5; do
    aws lambda create-function --function-name "$FN" --region "$REGION" --runtime nodejs22.x \
      --architectures arm64 --handler index.handler --role "$ROLE_ARN" --memory-size 512 --timeout 30 \
      --zip-file "fileb://$TMPZIP" --tags Proyecto=${PROYECTO} >/dev/null && break
    echo "  esperando a que IAM propague el rol…"; sleep 8
  done
  echo "  función creada"
fi
aws lambda wait function-updated --function-name "$FN" --region "$REGION"
# Retención de logs 30 días (evita acumular costo en CloudWatch)
aws logs create-log-group --log-group-name "/aws/lambda/$FN" --region "$REGION" 2>/dev/null || true
aws logs put-retention-policy --log-group-name "/aws/lambda/$FN" --retention-in-days 30 --region "$REGION"

if ! aws lambda get-function-url-config --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name "$FN" --region "$REGION" --auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$FN" --region "$REGION" --statement-id FunctionURLPublic \
    --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$FN" --region "$REGION" --statement-id FunctionURLInvoke \
    --action lambda:InvokeFunction --principal "*" --invoked-via-function-url >/dev/null 2>&1 || true
fi
FN_URL=$(aws lambda get-function-url-config --function-name "$FN" --region "$REGION" --query FunctionUrl --output text)
FN_HOST=$(echo "$FN_URL" | sed -E 's#https://([^/]+)/?#\1#')
echo "  Function URL: $FN_URL"

# ------------------------------------------------------------------ S3
log "S3 bucket privado $BUCKET (solo CloudFront puede leerlo)"
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging "TagSet=[{Key=Proyecto,Value=${PROYECTO}}]"
  aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
  # Conserva solo 5 días las versiones viejas de los archivos del portal
  aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration \
    '{"Rules":[{"ID":"limpia-versiones","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":5}}]}'
  echo "  bucket creado"
fi

# ------------------------------------------------------------------ CloudFront
log "CloudFront (https + caché para el portal, /api/* hacia la Lambda)"
OAC_ID=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='${PROYECTO}_OAC'].Id | [0]" --output text)
if [ "$OAC_ID" = "None" ] || [ -z "$OAC_ID" ]; then
  OAC_ID=$(aws cloudfront create-origin-access-control --origin-access-control-config \
    "Name=${PROYECTO}_OAC,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
    --query OriginAccessControl.Id --output text)
fi
# Política de caché para la API: no guarda nada (TTL 0, la Lambda manda no-store) pero sí comprime gzip/brotli.
API_CP=$(aws cloudfront list-cache-policies --type custom --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='${PROYECTO}_API'].CachePolicy.Id | [0]" --output text)
if [ "$API_CP" = "None" ] || [ -z "$API_CP" ]; then
  API_CP=$(aws cloudfront create-cache-policy --cache-policy-config "{
    \"Name\":\"${PROYECTO}_API\",\"MinTTL\":0,\"DefaultTTL\":0,\"MaxTTL\":1,
    \"ParametersInCacheKeyAndForwardedToOrigin\":{\"EnableAcceptEncodingGzip\":true,\"EnableAcceptEncodingBrotli\":true,
      \"HeadersConfig\":{\"HeaderBehavior\":\"whitelist\",\"Headers\":{\"Quantity\":1,\"Items\":[\"Authorization\"]}},
      \"CookiesConfig\":{\"CookieBehavior\":\"none\"},\"QueryStringsConfig\":{\"QueryStringBehavior\":\"all\"}}}" \
    --query CachePolicy.Id --output text)
fi
DIST_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='${PROYECTO}'].Id | [0]" --output text)
if [ "$DIST_ID" = "None" ] || [ -z "$DIST_ID" ]; then
  CFG=$(cat <<JSON
{
  "CallerReference": "${PROYECTO}-$(date +%s)",
  "Comment": "${PROYECTO}",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "PriceClass": "PriceClass_100",
  "HttpVersion": "http2and3",
  "Origins": {"Quantity": 2, "Items": [
    {"Id": "s3-portal", "DomainName": "${BUCKET}.s3.${REGION}.amazonaws.com",
     "OriginAccessControlId": "${OAC_ID}", "S3OriginConfig": {"OriginAccessIdentity": ""}},
    {"Id": "lambda-api", "DomainName": "${FN_HOST}",
     "CustomOriginConfig": {"HTTPPort": 80, "HTTPSPort": 443, "OriginProtocolPolicy": "https-only",
       "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]}, "OriginReadTimeout": 30}}
  ]},
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-portal", "ViewerProtocolPolicy": "redirect-to-https", "Compress": true,
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "AllowedMethods": {"Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}}
  },
  "CacheBehaviors": {"Quantity": 1, "Items": [{
    "PathPattern": "/api/*", "TargetOriginId": "lambda-api", "ViewerProtocolPolicy": "https-only", "Compress": true,
    "CachePolicyId": "${API_CP}", "OriginRequestPolicyId": "b689b0a8-53d0-40ab-baf2-68738e2966ac",
    "AllowedMethods": {"Quantity": 7, "Items": ["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
      "CachedMethods": {"Quantity": 2, "Items": ["GET","HEAD"]}}
  }]}
}
JSON
)
  DIST_ID=$(aws cloudfront create-distribution-with-tags --distribution-config-with-tags \
    "{\"DistributionConfig\": $CFG, \"Tags\": {\"Items\": [{\"Key\":\"Proyecto\",\"Value\":\"${PROYECTO}\"}]}}" \
    --query Distribution.Id --output text)
  echo "  distribución creada: $DIST_ID"
fi
DIST_ARN="arn:aws:cloudfront::${ACCOUNT}:distribution/${DIST_ID}"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"CloudFrontOnly\",\"Effect\":\"Allow\",
  \"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",
  \"Resource\":\"arn:aws:s3:::${BUCKET}/*\",\"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"${DIST_ARN}\"}}}]}"
DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)

log "Lambda: variables de entorno y permiso para subir documentos (Anexo D) solo a docs/"
aws iam put-role-policy --role-name "$ROLE" --policy-name "${PROYECTO}_S3Docs" --policy-document "{
  \"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\"],
  \"Resource\":\"arn:aws:s3:::${BUCKET}/docs/*\"}]}"
aws lambda update-function-configuration --function-name "$FN" --region "$REGION" \
  --environment "Variables={BUCKET=${BUCKET},PORTAL_URL=https://${DOMAIN}}" >/dev/null
aws lambda wait function-updated --function-name "$FN" --region "$REGION"

cat > "$HERE/outputs.env" <<EOF
REGION=$REGION
BUCKET=$BUCKET
FUNCTION=$FN
FUNCTION_URL=$FN_URL
DISTRIBUTION_ID=$DIST_ID
PORTAL_URL=https://$DOMAIN
EOF
log "Listo. Portal: https://$DOMAIN"
