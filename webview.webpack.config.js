const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'development',
  entry: {
    'editor': './src/webview/editor.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'media'),
    filename: 'editor.js',
  },
  devtool: 'source-map',
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    fallback: {
      // Polyfills for Node.js core modules
      "buffer": require.resolve("buffer/"),
      "stream": require.resolve("stream-browserify"),
      "util": require.resolve("util/"),
      "process": require.resolve("process/browser"),
      "path": require.resolve("path-browserify"),
      "url": require.resolve("url/"),
      "crypto": require.resolve("crypto-browserify"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "zlib": require.resolve("browserify-zlib"),
      "net": false,
      "tls": false,
      "fs": false,
      "os": require.resolve("os-browserify/browser")
    }
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.webpack.json',
              transpileOnly: true
            }
          }
        ],
        exclude: /node_modules/
      }
    ]
  },
  plugins: [
    // Make browser-friendly versions of Node.js globals
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer']
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development')
    })
  ]
};
