# 🌿 Espaço Lígia de Mayor — Fisioterapia & Estúdio de Pilates

Landing page moderna, minimalista e de alta conversão desenvolvida para o **Espaço Lígia de Mayor**, localizado em Copacabana, Rio de Janeiro. 

Projetada com foco em bem-estar, saúde e movimento (paleta inspirada na referência clínica moderna com Azul Profundo `#123D63`, Turquesa `#43AEBB`, Azul Claro `#EAF6F8` e Branco `#FFFFFF`), performance máxima, SEO local e integração direta com o WhatsApp.

---

## 📁 Estrutura de Arquivos Modular

Este projeto foi construído em arquitetura estática pura, leve e pronta para hospedagem compartilhada, sem necessidade de servidores Node complexos na produção:

```text
├── index.html          # Código HTML5 semântico, metatags OpenGraph e SEO Schema.org
├── css/
│   └── style.css       # Estilos CSS3 modernos, variáveis de cor, Flexbox e CSS Grid
├── js/
│   └── main.js         # Interatividades: menu mobile, acordeon FAQ, WhatsApp e rolagem
└── README.md           # Guia de publicação no GitHub e deploy na Hostinger
```

---

## 🚀 Passo a Passo: Subir para o GitHub

### 1. Criar o Repositório no GitHub
1. Acesse sua conta em [github.com](https://github.com) e clique em **New repository** (Novo repositório).
2. Dê um nome ao repositório, por exemplo: `espaco-ligia-de-mayor`.
3. Deixe o repositório como **Public** ou **Private** (ambos funcionam com a Hostinger).
4. **Não marque** as opções de criar README inicial (já temos o nosso pronto).
5. Clique em **Create repository**.

### 2. Enviar os Arquivos via Linha de Comando (Terminal)
Abra o terminal na pasta raiz do projeto no seu computador e execute:

```bash
# 1. Inicialize o repositório git local (caso ainda não tenha inicializado)
git init

# 2. Adicione todos os arquivos
git add .

# 3. Faça o commit inicial
git commit -m "feat: landing page completa Espaço Ligia de Mayor"

# 4. Renomeie a branch principal para main
git branch -M main

# 5. Conecte ao seu repositório no GitHub (substitua pelo link do seu repositório)
git remote add origin https://github.com/SEU-USUARIO/espaco-ligia-de-mayor.git

# 6. Faça o envio (push) para o GitHub
git push -u origin main
```

---

## 🌐 Passo a Passo: Deploy Automático na Hostinger

A Hostinger possui suporte nativo a repositórios Git no painel de controle **hPanel**, permitindo que qualquer atualização enviada ao GitHub seja automaticamente publicada no seu site.

### Método 1: Integração Git no hPanel (Recomendado)

1. Faça login na sua conta da **[Hostinger](https://hpanel.hostinger.com)**.
2. Selecione o seu domínio (ex: `espacoligiademayor.com.br`) e vá em **Painel de Controle**.
3. Na barra de busca lateral esquerda, procure por **Git** (na seção *Avançado*).
4. Clique em **Git** e configure:
   - **Repositório Git**: Cole a URL do repositório (ex: `https://github.com/SEU-USUARIO/espaco-ligia-de-mayor.git`).
   - **Branch**: Selecione `main` (ou `master`).
   - **Instalar no Diretório**: Deixe em branco para instalar diretamente na raiz `public_html`.
5. Clique em **Criar** / **Create**.
6. A Hostinger irá clonar os arquivos. Sempre que você fizer um `git push` no seu computador, basta clicar no botão **Auto-Deploy** ou **Deploy** na mesma página do hPanel para atualizar o site instantaneamente!

---

### Método 2: Via Gerenciador de Arquivos da Hostinger (Alternativa Rápida)

Se preferir não usar o Git no primeiro momento:

1. No hPanel da Hostinger, clique em **Gerenciador de Arquivos** (*File Manager*).
2. Acesse a pasta `public_html`.
3. Compacte os arquivos (`index.html`, pasta `css`, pasta `js`) em um arquivo `.zip`.
4. Faça o upload do `.zip` para a pasta `public_html`.
5. Clique com o botão direito no `.zip` dentro da Hostinger e escolha **Extrair** (*Extract*).
6. Certifique-se de que o `index.html` esteja diretamente dentro de `public_html`.

---

## 🔒 Ativar Certificado SSL Grátis (HTTPS)

1. No hPanel da Hostinger, vá até a seção **Segurança** > **SSL**.
2. Clique em **Instalar SSL** (Let's Encrypt gratuito fornecido pela Hostinger).
3. Ative a opção **Forçar HTTPS** para garantir navegação 100% segura para os seus clientes.

---

## 🎬 Vídeo de Fundo na Primeira Seção (Hero Video)

A primeira seção do site utiliza vídeo cinematográfico contínuo em alta performance com:
- **Reprodução automática silenciosa e em loop**: `autoplay`, `muted`, `loop`, `playsinline`.
- **Faixa de áudio removida** (`-an`) para download ultrarrápido e zero consumo de banda com som.
- **Fast Start ativado** (`-movflags +faststart`) para início imediato do streaming antes do download completo.
- **Versão WebM e versão MP4 H.264** para compatibilidade universal em navegadores desktop e mobile.
- **Poster imediato** (`hero-studio-poster.jpg`) exibido instantaneamente sem tela preta.
- **Botão acessível de Play/Pause**: permite que qualquer usuário pause ou retome o movimento conforme preferência de conforto visual.
- **Controle inteligente de economia de bateria/dados**:
  - Pausa automática ao rolar para fora da seção (IntersectionObserver).
  - Pausa automática ao minimizar ou trocar de aba no navegador (Visibility API).
  - Respeito a `prefers-reduced-motion: reduce` e `navigator.connection.saveData`.

### Arquivos de Mídia na Pasta `assets/` e `public/assets/`:
1. `hero-studio-poster.jpg` (~154 KB) — Frame representativo do estúdio.
2. `hero-studio-ligia.mp4` (~258 KB) — Vídeo H.264 720p otimizado, sem áudio, faststart.
3. `hero-studio-ligia.webm` (~358 KB) — Vídeo WebM moderno para navegadores compatíveis.
4. `hero-studio-mobile.mp4` (~140 KB) — Versão leve em 480p para dispositivos móveis.

### Como Otimizar um Novo Arquivo de Vídeo Gravado:
Caso você queira substituir o vídeo por uma nova gravação do estúdio, utilize o script automatizado incluído:
```bash
# Converte e gera automaticamente poster, MP4 faststart, WebM e versão mobile:
./scripts/optimize-video.sh caminho/do/seu-novo-video.mp4
```

---

## 📞 Informações de Contato Configuradas

- **Clínica:** Espaço Lígia de Mayor - Fisioterapia &amp; Pilates
- **Endereço:** Av. Nossa Sra. de Copacabana, 807 - Sala 706, Copacabana, Rio de Janeiro - RJ, 22050-002
- **WhatsApp:** (21) 99717-2737 (`https://wa.me/5521997172737`)
- **Instagram:** [@espacoligiademayor](https://instagram.com/espacoligiademayor) e [@ligiademayor](https://instagram.com/ligiademayor)
- **Horário:** Segunda a Sexta, das 07h às 21h
