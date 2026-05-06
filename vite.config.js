import { defineConfig, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        {
            name: 'treat-js-files-as-jsx',
            enforce: 'pre',
            async transform(code, id) {
                if (!id.match(/src\/.*\.js$/)) return null;
                return transformWithOxc(code, id, { lang: 'jsx' });
            },
        },
        visualizer({
            open: process.env.VISUALIZER_OPEN === 'true', // Control auto-open via env var
            filename: "stats.html", // Name of the output file
            gzipSize: true, // Show gzip sizes
            brotliSize: true, // Show brotli sizes
            template: 'treemap', // 'treemap', 'list', 'sunburst', 'network'
        }),
        react(),
        viteStaticCopy({
            targets: [
                {
                    src: 'src/lib/assets',
                    dest: '.',
                },
            ],
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 3000,
        open: true,
    },
    build: {
        lib: {
            entry: path.resolve(__dirname, 'src/lib/index.js'),
            formats: ['es'],
            fileName: 'index',
        },
        rollupOptions: {
            // Externalize peer dependencies and their deep imports
            external: (id) => {
                const externalPackages = [
                    'react',
                    'react-dom',
                    '@emotion/react',
                    '@emotion/styled',
                    '@mui/icons-material',
                    '@mui/material',
                    '@mui/x-data-grid-premium',
                    '@mui/x-date-pickers',
                    '@mui/x-tree-view',
                    '@base-ui/react',
                    'dayjs',
                    'formik',
                    'i18next',
                    'i18next-browser-languagedetector',
                    'react-i18next',
                    'react-router-dom',
                    'yup'
                ];
                
                // Check if the import is from any external package or its sub-paths
                return externalPackages.some(pkg => id === pkg || id.startsWith(pkg + '/'));
            },
            output: {
                globals: {
                    react: 'React',
                    'react-dom': 'ReactDOM',
                },
            },
        },
        outDir: 'dist',
        sourcemap: true,
        minify: false,
        target: 'es2020',
        // Copy assets from src/lib/assets to dist
        copyPublicDir: false,
    },
});
