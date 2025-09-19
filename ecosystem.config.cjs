//для установления времени Братислава на AWS
module.exports = {
  apps: [
    {
      name: "[fastcredit-sk]-root-server",
      script: "./server.js",
      env: {
        NODE_ENV: "production",
        PORT: 10001,
        TZ: "Europe/Bratislava",
      },
    },
  ],
};
