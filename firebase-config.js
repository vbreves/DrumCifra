/* =============================================
   Firebase Configuration
   
   INSTRUÇÕES:
   1. Acesse https://console.firebase.google.com
   2. Clique "Adicionar projeto" e crie um projeto (ex: "drumcifra")
   3. No projeto, vá em "Cloud Firestore" > "Criar banco de dados"
      - Selecione "Modo de teste" (para começar)
      - Escolha a região mais próxima (southamerica-east1 para Brasil)
   4. Vá em Configurações do Projeto (engrenagem) > "Seus apps" > ícone Web (</>)
   5. Registre o app (nome: "DrumCifra")
   6. Copie os valores do firebaseConfig e cole abaixo
   ============================================= */

const firebaseConfig = {
    apiKey: "AIzaSyCCwTZ0V63ZXRaXpkPYffr_zdereONstlo",
    authDomain: "drumcifra.firebaseapp.com",
    databaseURL: "https://drumcifra-default-rtdb.firebaseio.com",
    projectId: "drumcifra",
    storageBucket: "drumcifra.firebasestorage.app",
    messagingSenderId: "617347477720",
    appId: "1:617347477720:web:3ff9de5c833a44bcdba7ad"
};

// Inicializa Firebase (só se configurado)
let db = null;
if (firebaseConfig.apiKey !== "COLE_AQUI") {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
}
