const unwrapCascadeLayers = {
  postcssPlugin: "unwrap-cascade-layers-for-legacy-chrome",
  AtRule: {
    layer: (atRule) => {
      if (atRule.nodes) {
        atRule.replaceWith(...atRule.nodes);
      } else {
        atRule.remove();
      }
    },
  },
};

const config = {
  plugins: ["@tailwindcss/postcss", unwrapCascadeLayers],
};

export default config;
