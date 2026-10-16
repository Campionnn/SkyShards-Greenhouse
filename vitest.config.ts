import { defineConfig } from "vitest/config";
import { greenhouseImagesPlugin } from "./vite.greenhouseImages";

export default defineConfig({
  plugins: [greenhouseImagesPlugin()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
