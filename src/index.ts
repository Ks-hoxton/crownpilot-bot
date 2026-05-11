import { createBot } from "./bot.js";
import { getConfig } from "./config.js";
import { createHttpServer } from "./server.js";
import { ReminderService } from "./services/reminder-service.js";

async function main() {
  const config = getConfig();
  const bot = createBot();
  const server = createHttpServer(bot);
  const reminderService = new ReminderService(bot);

  server.listen(config.PORT, () => {
    console.log(`HTTP server is listening on port ${config.PORT}`);
  });

  reminderService.start();
  void bot.start({
    onStart() {
      console.log("Telegram CEO Copilot is running via long polling");
    }
  });
}

main().catch((error) => {
  console.error("Failed to start bot", error);
  process.exit(1);
});
