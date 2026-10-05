#!/bin/bash
# ==============================================================================
# Script de Otimização de Vídeo para Web - Espaço Lígia de Mayor
# Converte qualquer vídeo original gravado para padrões ultraleves de alta performance:
#  - Remove áudio desnecessário (-an) para autoplay silencioso
#  - Aplica codec H.264 perfil High com fast start (-movflags +faststart)
#  - Gera versão WebM moderna (VP9/VP8)
#  - Gera versão leve especial para celulares
#  - Extrai poster em frame de alta nitidez
# ==============================================================================

set -e

INPUT_FILE="$1"

if [ -z "$INPUT_FILE" ]; then
  echo "Uso: ./scripts/optimize-video.sh <arquivo-de-video-original.mp4>"
  exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
  echo "Erro: Arquivo '$INPUT_FILE' não encontrado."
  exit 1
fi

mkdir -p assets public/assets

echo "1. Extraindo imagem poster de alta resolução (frame inicial)..."
ffmpeg -y -i "$INPUT_FILE" -ss 00:00:01 -vframes 1 -q:v 3 public/assets/hero-studio-poster.jpg
cp public/assets/hero-studio-poster.jpg assets/hero-studio-poster.jpg

echo "2. Otimizando vídeo principal MP4 (H.264, 720p, sem áudio, faststart)..."
ffmpeg -y -i "$INPUT_FILE" -an -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720" \
  -c:v libx264 -profile:v high -level 4.0 -preset slow -crf 23 \
  -movflags +faststart public/assets/hero-studio-ligia.mp4
cp public/assets/hero-studio-ligia.mp4 assets/hero-studio-ligia.mp4

echo "3. Gerando versão WebM alternativa..."
ffmpeg -y -i "$INPUT_FILE" -an -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720" \
  -c:v libvpx -b:v 450k -crf 25 public/assets/hero-studio-ligia.webm
cp public/assets/hero-studio-ligia.webm assets/hero-studio-ligia.webm

echo "4. Gerando versão mobile ultra-otimizada (480p)..."
ffmpeg -y -i "$INPUT_FILE" -an -vf "scale=854:480:force_original_aspect_ratio=increase,crop=854:480" \
  -c:v libx264 -profile:v baseline -level 3.0 -preset fast -crf 26 \
  -movflags +faststart public/assets/hero-studio-mobile.mp4
cp public/assets/hero-studio-mobile.mp4 assets/hero-studio-mobile.mp4

echo "Concluído com sucesso! Arquivos gerados em assets/ e public/assets/:"
ls -lh public/assets/hero-studio*
