const path = require('path');

module.exports = {
  mode: 'production',

  // Entry: the "small React app" that lives under src/webview/editor.tsx
  entry: path.resolve(__dirname, 'src', 'webview', 'editor.tsx'),

  // Output: put the bundle into /media/editor.js
  output: {
    path: path.resolve(__dirname, 'media'),
    filename: 'editor.js',
    libraryTarget: 'umd'
  },

  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    // Don't append .js when importing TypeScript files
    extensionAlias: {
      '.ts': ['.js', '.ts'],
      '.tsx': ['.js', '.jsx', '.tsx']
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
              transpileOnly: true // Use this for faster builds
            }
          }
        ],
        exclude: /node_modules/
      }
    ]
  },

  // Since we want to bundle everything into editor.js
  // we do NOT declare externals here.
}
