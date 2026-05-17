import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3003, // Different port from other projects
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY),
        'process.env.PEXELS_API_KEY': JSON.stringify(env.PEXELS_API_KEY || process.env.PEXELS_API_KEY),
        'process.env.BLOG_URL': JSON.stringify('https://greenthumb-kr.tistory.com'),
        'process.env.REDIS_PREFIX': JSON.stringify('plantguide:')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
