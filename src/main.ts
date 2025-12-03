import { createApp } from "vue";
import { createPinia } from "pinia";
import router from "./router";
import "./style.css";
import 'highlight.js/styles/atom-one-dark.css';
import App from "./App.vue";
import { syncService } from "./services/sync";

const app = createApp(App);

app.use(createPinia());
app.use(router);

// Initialize sync service
syncService.init();

app.mount("#app");
