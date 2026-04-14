
# Eye Tracking App

Aplicativo mobile desenvolvido com React Native e Expo, com foco em detecção facial e rastreamento ocular utilizando a câmera frontal do dispositivo.

## Sobre o projeto

Este projeto foi desenvolvido como parte de uma iniciação, com o objetivo de estudar visão computacional aplicada a dispositivos móveis. A aplicação utiliza a câmera frontal para detectar o rosto do usuário e identificar a posição aproximada dos olhos em tempo real.

Além da captura de imagem, o projeto também explora o uso de processamento de frames e landmarks faciais, permitindo visualizar na tela os pontos detectados correspondentes aos olhos.

## Objetivo

O objetivo principal deste projeto é investigar a viabilidade de um sistema de eye tracking em ambiente mobile, utilizando bibliotecas compatíveis com React Native.


## Tecnologias e versões

-   Expo: 54.0.33
    
-   React: 19.1.0
    
-   React Native: 0.81.5
    
-   React Native Vision Camera: 4.7.3
    
-   React Native Vision Camera Face Detector: 1.10.2
    
-   React Native Worklets Core: 1.6.3
    
-   TypeScript: 5.9.2
    
-   Java: 17.0.12
    

## Funcionalidades atuais

-   Solicitação de permissão para uso da câmera
    
-   Acesso à câmera frontal do dispositivo
    
-   Detecção facial em tempo real
    
-   Identificação de landmarks faciais
    
-   Marcação visual aproximada da posição dos olhos na tela
    
-   Exibição das coordenadas detectadas
    

## Estrutura do projeto

```text
android/
app/
assets/
components/
constants/
hooks/
scripts/
app.json
app.tsx
babel.config.js
eslint.config.js
package.json
package-lock.json
tsconfig.json
```

## Requisitos para execução

Antes de rodar o projeto, é necessário ter instalado:

-   Node.js
    
-   Java 17
    
-   Android Studio
    
-   Android SDK configurado
    
-   Dispositivo Android físico ou emulador
    

## Como executar o projeto

Instale as dependências:

```bash
npm install
```

Execute o projeto:

```bash
npx expo run:android
```

## Geração do APK

Para gerar um APK de debug localmente:

```bash
cd android
.\gradlew assembleDebug

```

O arquivo gerado normalmente estará em:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Observações

Como o projeto utiliza bibliotecas nativas para processamento da câmera, a execução não ocorre apenas com Expo Go. Por isso, é necessário realizar a compilação nativa para Android.

## Finalidade acadêmica

Este projeto possui finalidade acadêmica e experimental, sendo utilizado para estudo de integração entre visão computacional, processamento em tempo real e desenvolvimento mobile com React Native.

## Autor

Gabriel Makiyama Nakashima



