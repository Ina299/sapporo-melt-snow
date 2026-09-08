const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'tests/browser',use:{baseURL:'http://127.0.0.1:8000',headless:true,channel:'msedge'},
  webServer:{command:'python -m http.server 8000 --bind 127.0.0.1',url:'http://127.0.0.1:8000/web/',reuseExistingServer:true},
  reporter:'list'});
