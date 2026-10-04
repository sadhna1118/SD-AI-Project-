import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.loca.lt', '*.trycloudflare.com', '*.ngrok-free.app', '192.168.1.7', '192.168.56.1', 'localhost', '127.0.0.1'],
};

export default nextConfig;
