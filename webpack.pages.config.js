const path = require('path');

const CleanWebpackPlugin = require('clean-webpack-plugin');
const { VueLoaderPlugin } = require('vue-loader');

module.exports = (env, argv) => ({
  entry: {
    'project-page': './app/views/scripts/src/project-page.js',
    'project-new-page': './app/views/scripts/src/project-new-page.js',
    'project-settings-page': './app/views/scripts/src/project-settings-page.js',
    'user-page': './app/views/scripts/src/user-page.js',
    'embed-page': './app/views/scripts/src/embed-page.js',
    'data-page': './app/views/scripts/src/data-page.js'
  },
  devtool: argv.mode === 'development' ? 'eval-source-map' : 'source-map',
  plugins: [
    new CleanWebpackPlugin(['dist']),
    new VueLoaderPlugin()
  ],
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'app/views/scripts/dist')
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        type: 'asset/resource'
      },
      {
        test: /\.vue$/,
        loader: 'vue-loader'
      }
    ]
  },
  resolve: {
    symlinks: false
  }
});
