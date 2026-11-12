// Development settings (used by `ng serve`).
export const environment = {
  production: false,
  // Empty = same origin; `ng serve` proxies /api to http://localhost:3000 (see proxy.conf.json)
  // Port 8787 is `wrangler dev`..
  apiUrl: '',
  firebase: {
    apiKey: 'AIzaSyB-ILcjyXEt6GftpfWYbSba5N_e_Bmuxdo',
    authDomain: 'personal-finances-1cbca.firebaseapp.com',
    projectId: 'personal-finances-1cbca',
    appId: '1:592015370930:web:69d61c4230adeaecd677ab',
  },
};
