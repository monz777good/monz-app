import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://ugevhxasutnwtlxvittm.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZXZoeGFzdXRud3RseHZpdHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5OTg3NjcsImV4cCI6MjA4ODU3NDc2N30.du98yhKfF6chdVT31n9py9btirUKmOYMJvF1_d9k1Ao",
  },
};

export default nextConfig;