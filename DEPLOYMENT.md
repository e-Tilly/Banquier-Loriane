# Le Banquier - Jeu Web Mobile 🎁

Version web mobile du jeu "Le Banquier" optimisée pour Samsung Galaxy S23 Ultra et tous les smartphones.

## 🚀 Déploiement GRATUIT

### Option 1: GitHub Pages (GRATUIT)

1. **Créer un compte GitHub** (si pas déjà fait): https://github.com

2. **Créer un nouveau repository**:
   - Nom: `banker-game` (ou autre)
   - Public
   - Ne pas initialiser avec README

3. **Publier le jeu**:
```bash
cd "c:\Users\fr6106046\Documents\Cadeau lo\BankerGameWeb"

# Build pour production
dotnet publish -c Release

# Installer l'outil de déploiement GitHub Pages
dotnet tool install --global PublishSPAforGitHubPages.Build

# Ou si déjà installé, mettre à jour
dotnet tool update --global PublishSPAforGitHubPages.Build

# Configurer Git (première fois seulement)
git config --global user.name "Votre Nom"
git config --global user.email "votre@email.com"

# Initialiser et publier
cd bin\Release\net9.0\publish\wwwroot
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/VOTRE-USERNAME/banker-game.git
git push -u origin main
```

4. **Activer GitHub Pages**:
   - Aller sur votre repo GitHub
   - Settings → Pages
   - Source: "Deploy from a branch"
   - Branch: `main` / `root`
   - Save

5. **Accéder au jeu**:
   - URL: `https://VOTRE-USERNAME.github.io/banker-game/`
   - Partager ce lien!

### Option 2: Netlify (GRATUIT - Plus simple)

1. **Créer un compte**: https://netlify.com

2. **Build le projet**:
```bash
cd "c:\Users\fr6106046\Documents\Cadeau lo\BankerGameWeb"
dotnet publish -c Release -o publish
```

3. **Déployer**:
   - Aller sur https://app.netlify.com/drop
   - Glisser-déposer le dossier: `publish\wwwroot`
   - Netlify génère une URL instantanément!

4. **URL personnalisée** (optionnel):
   - Site settings → Change site name
   - Ex: `banker-game-birthday.netlify.app`

### Option 3: Azure Static Web Apps (GRATUIT)

1. **Compte Azure** (gratuit): https://azure.microsoft.com/free

2. **Créer une Static Web App**:
   - Portail Azure → Create Resource → Static Web App
   - Nom: banker-game
   - Plan: Free
   - Region: West Europe
   - Source: Other

3. **Déployer**:
```bash
# Installer Azure CLI
winget install Microsoft.AzureCLI

# Login
az login

# Déployer
cd "c:\Users\fr6106046\Documents\Cadeau lo\BankerGameWeb"
dotnet publish -c Release
az staticwebapp upload --app bin\Release\net9.0\publish\wwwroot
```

### Option 4: Vercel (GRATUIT)

1. **Compte Vercel**: https://vercel.com

2. **Installer Vercel CLI**:
```bash
npm install -g vercel
```

3. **Déployer**:
```bash
cd "c:\Users\fr6106046\Documents\Cadeau lo\BankerGameWeb"
dotnet publish -c Release
cd bin\Release\net9.0\publish\wwwroot
vercel --prod
```

## 📱 Caractéristiques Mobiles

- ✅ **Optimisé Samsung Galaxy S23 Ultra** (1440x3088px)
- ✅ **Design responsive** - fonctionne sur tous les téléphones
- ✅ **Pas de scroll** - toutes les info visibles
- ✅ **Couleurs Deal or No Deal** - bleu, rouge, or
- ✅ **Touch-friendly** - boutons larges
- ✅ **Pas de zoom** - expérience native
- ✅ **Support landscape** - grille adapte automatiquement
- ✅ **Progressive Web App** - peut s'installer sur l'écran d'accueil

## 🎨 Couleurs Deal or No Deal

- **Bleu principal**: #0047AB (coffrets)
- **Rouge**: #C41E3A (offres refusées)
- **Or**: #FFD700 (accents, bordures)
- **Dégradés bleu**: #4A90E2 → #0047AB (petits prix)
- **Dégradés orange/rouge**: #FFB74D → #880E4F (gros prix)

## 🎮 Comment Jouer

1. Ouvrir l'URL depuis n'importe quel smartphone
2. Le jeu s'affiche en plein écran
3. Toucher les coffrets pour jouer
4. Pas besoin d'installer d'application!

## 💡 Tester Localement

```bash
cd "c:\Users\fr6106046\Documents\Cadeau lo\BankerGameWeb"
dotnet run
```

Puis ouvrir: `https://localhost:5001`

Pour tester sur téléphone (même WiFi):
```bash
dotnet run --urls "http://0.0.0.0:5000"
```

Puis sur le téléphone: `http://[IP-DE-VOTRE-PC]:5000`

## 🎯 Recommandation

**Pour une publication simple et rapide**: Utiliser **Netlify Drop**
1. Build une fois
2. Drag & drop
3. URL instantanée
4. Aucun compte requis

**Pour un contrôle total**: Utiliser **GitHub Pages**
1. Versionné avec Git
2. URL personnalisable
3. Gratuit à vie
4. Peut ajouter domaine personnalisé

## 🔧 Personnalisation

Les cadeaux peuvent être modifiés dans:
`Services/GameService.cs` → méthode `InitializePrizes()`

## 📊 Statistiques

- **Taille totale**: ~5 MB (après compression)
- **Temps de chargement**: 2-5 secondes
- **Compatible**: Tous navigateurs modernes (Chrome, Safari, Firefox, Edge)
- **Hors ligne**: Fonctionne après premier chargement (PWA)

Bon jeu et joyeux anniversaire! 🎂🎁
