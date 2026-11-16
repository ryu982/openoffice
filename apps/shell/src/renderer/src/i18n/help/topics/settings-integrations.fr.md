# Paramètres, langue, thème et intégrations MCP

## Ouvrir les paramètres

La ligne en bas à gauche de l’accueil ouvre le panneau des paramètres (la ligne en dessous indique si une IA est connectée). Il comporte cinq sections : Compte, IA, Général, Intégrations et À propos.

Vous pouvez aussi l’ouvrir depuis n’importe quel onglet avec **⌘,** (Ctrl+, sous Windows et Linux), depuis **Paramètres…** dans le menu de l’application sur un Mac (le menu qui porte le nom de l’app, à gauche de la barre des menus), ou depuis **Menu (☰) ▸ Paramètres…** sous Windows et Linux. Dans un onglet Word, ⌘, (Ctrl+,) sert à l’indice : passez alors par le menu.

**Compte** indique où en sont vos connexions Claude, ChatGPT et Codex, et **Gérer les connexions** mène à la section IA. L’IA a ses propres articles : [Connexion par abonnement](help://subscription) et [Modèles IA et paramètres](help://ai-models).

## Langue

- Les paramètres proposent **22 langues d’interface** : anglais, chinois simplifié, japonais, coréen, français, allemand, espagnol, thaï, indonésien, russe, arabe, portugais, italien, polonais, tchèque, néerlandais, malais, hébreu, hindi, chinois traditionnel, vietnamien, turc.
- Le changement s’applique immédiatement et est conservé ; la barre de menus native est reconstruite dans la langue choisie.

## Thème

Clair / Sombre / Suivre le système. Suivre le système suit l’apparence de l’OS, et les éditeurs changent de apparence en même temps sans clignotement.

## Général

- **Position de la barre latérale IA** (à gauche ou à droite), **Taille du texte du panneau IA** et **Correction orthographique dans le chat IA**.
- **Panneau IA** — Désactivé, Replié ou Dernier état.
- **Enregistrer automatiquement tous les documents** active l'enregistrement automatique par défaut dans tous les éditeurs ; vous pouvez toujours le désactiver pour une fenêtre.
- **Emplacement d'enregistrement** avec un bouton **Modifier** et **Application par défaut pour les documents Office** pour attribuer .docx / .xlsx / .pptx à GenOffice.
- **Format d'enregistrement des nouveaux documents HWP** choisit si HWP ou HWPX est proposé en premier lors du premier enregistrement d'un nouveau document. Les documents ouverts conservent leur propre format.
- **Polices des diapositives IA** définit les polices que l’IA utilise pour une nouvelle présentation lorsque votre demande n’en nomme aucune. Choisissez Auto, Sans empattement, Avec empattement ou Titres avec empattement, et changez séparément la police sans empattement et la police avec empattement. Un modèle de conception choisi utilise ses propres polices, et les pages ajoutées à une présentation dans d’autres polices suivent cette présentation.

GenOffice ne collecte ni n’envoie de statistiques d’utilisation : il n’y a donc pas d’interrupteur pour cela.

## Éditeurs et IA

Vous choisissez ici les éditeurs que vous utilisez et si vous utilisez l’IA. La même liste apparaît aussi une fois à deux autres endroits : l’étape **Choisissez vos éditeurs** des écrans de bienvenue au premier lancement, et une fenêtre affichée une seule fois sur l’accueil pour les personnes qui utilisaient GenOffice avant l’arrivée de ce réglage. Tout est activé au départ : si vous ne touchez à rien, rien ne change. Une modification s’applique tout de suite dans toutes les fenêtres ouvertes.

- **Éditeurs** : Word, Excel, PowerPoint, PDF, Outils PDF, Markdown et texte, HTML, Carte mentale, Diagramme, HWP (Hangul) et Livre numérique (EPUB). Les outils PDF s’activent séparément de l’éditeur PDF. Au moins un éditeur doit rester activé.
- **Un éditeur désactivé** disparaît des listes de nouveaux documents : les cartes de l’accueil, le menu **+** de la barre d’onglets, Fichier ▸ Nouveau et la liste des applications par défaut. Les documents déjà ouverts restent ouverts, et les copies de récupération sont conservées.
- **Ouvrir un fichier d’un éditeur désactivé** (double-clic, glisser-déposer, Fichier ▸ Ouvrir, fichiers récents) vous demande de choisir **Activer et ouvrir** ou **Annuler**. Si vous ouvrez plusieurs de ses fichiers à la fois, la question n’est posée qu’une fois.
- **Les autres fonctions qui ouvriraient leur résultat dans un éditeur désactivé**, comme la conversion d’un PDF dans ce format, demandent avant de commencer : **Activer et ouvrir**, **Créer seulement le fichier** (le fichier est créé et affiché dans son dossier, l’éditeur reste désactivé) ou **Annuler**.
- **Quand les fonctions d’IA sont désactivées**, les panneaux IA, les boutons et menus IA, le panneau de questions de l’accueil, la fenêtre de l’agent et les invitations à connecter une IA disparaissent, et les onglets Compte, IA et Compétences quittent les paramètres. GenOffice ne lance aucun programme d’IA depuis ses écrans. Connexions, clés, compétences et réglages sont conservés et reviennent quand vous réactivez l’IA. Si un travail d’IA est encore en cours, on vous demande d’abord si vous voulez **Arrêter et désactiver**.
- La ligne de commande, MCP et ce guide fonctionnent de la même façon, que les éditeurs ou l’IA soient activés ou non.

Même avec l’IA activée, l’IA ne crée pas de nouveaux documents pour un éditeur désactivé ; elle vous dit de l’activer ici.

## IA ▸ Avancé

Repliée tant que vous ne l’ouvrez pas ; la plupart des gens n’en ont jamais besoin. L’onglet **Modèle IA** contient les clés API et les serveurs que vous faites tourner vous-même, pour la conversation. Dans l’onglet **Médias IA et recherche**, chaque capacité choisit le fournisseur qui la sert, et la clé et l'URL de base d'un fournisseur sont saisies une seule fois et partagées :

- **Recherche web**, **Génération d'images**, **Analyse d'images** et **Analyse vidéo**, chacune avec un fournisseur, un modèle, une clé et une URL de base.
- La **recherche de fichiers locale** tourne sur cette machine. En dessous, le **reranking de recherche Jev** est **désactivé par défaut**. Activez-le et les extraits des 20 premiers résultats locaux — jusqu'à 1 200 caractères par document, plus noms de fichiers et de dossiers — partent vers le point de terminaison de décision choisi (Jev via OpenRouter ou TypeSafe, Perplexity, Liquid AI d1, Cloudflare, un moteur local ou une URL personnalisée) pour être réordonnés par pertinence. Désactivé, rien ne quitte l'appareil.
- **Autoriser les requêtes automatiques à utiliser un abonnement** est **désactivé par défaut**. Ce réglage décide si une requête venue de la ligne de commande ou d’un agent de programmation connecté peut utiliser votre abonnement Claude ou Codex ; voir [Connecter un agent de codage](help://mcp).

## À propos

- **Version**, l’adresse GitHub du projet et une ligne qui nomme le projet open source sur lequel cette application est basée.
- **Canal de mise à jour** : Stable ou Bêta. Une modification prend effet immédiatement et déclenche une recherche de mise à jour ; elle ne rétrograde pas une installation Bêta vers Stable.

## Associations d’applications par défaut

Les paramètres peuvent enregistrer GenOffice comme gestionnaire de .docx / .xlsx / .pptx / .pdf et formats similaires (enregistrement d’application par défaut au niveau de la plateforme ; confirmez lorsque l’on vous le demande).

## Mentions relatives aux logiciels tiers et mises à jour

- Aide ▸ Mentions relatives aux logiciels tiers : l’inventaire complet des licences open source livré avec l’application.
- Menu (☰) ▸ Vérifier les mises à jour (sur un Mac, Aide ▸ Vérifier les mises à jour) : déclenche une vérification manuelle ; une version plus récente propose l’installation. Sur un Mac, le menu de l’application la propose aussi, juste sous « À propos de GenOffice ».

## Intégration MCP (pour les utilisateurs avancés / clients IA)

**Intégrations** est le panneau qui relie GenOffice à un agent de codage, et il a son propre article : Connecter un agent de codage. La version courte — choisissez une voie (la ligne de commande, ou MCP), suivez la section correspondante, puis ouvrez une nouvelle conversation et posez votre question.

Sous **Serveur HTTP local**, l’application peut aussi lancer le serveur elle-même — un interrupteur d’activation et un port —, et **Avancé** ajoute l’URL du test de santé et le fichier journal, au lieu de le laisser à l’assistant. Elle n’écoute que sur localhost.

## Aide-mémoire de la ligne de commande

| Commande            | Ce qu’elle fait                 |
| ------------------- | ------------------------------- |
| `ieumoffice <file>` | ouvrir un fichier               |
| `ieumoffice mcp`    | démarrer le serveur MCP local   |
| `ieumoffice --help` | toutes les commandes et options |
