// Production settings (used by `ng build`).
// The Firebase web config is NOT secret — it is safe to commit. Copy it from
// Firebase console -> Project settings -> General -> Your apps -> Web app.
export const environment = {
  production: true,
  // Empty = same origin: the Cloudflare Worker serves both the app and /api/*.
  apiUrl: '',
  firebase: {
    apiKey: 'AIzaSyB-ILcjyXEt6GftpfWYbSba5N_e_Bmuxdo',
    authDomain: 'personal-finances-1cbca.firebaseapp.com',
    projectId: 'personal-finances-1cbca',
    appId: '1:592015370930:web:69d61c4230adeaecd677ab',
  },
};
