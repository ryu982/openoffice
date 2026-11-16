# Opérations sur les fichiers : renommer, supprimer, exporter

Ce chapitre couvre les opérations sur les fichiers communes à tous les éditeurs ; les options d’export propres à chaque éditeur sont dans son chapitre.

Le **menu ⋯** de la ligne (survolez une ligne de fichier) rassemble ces actions :

![Le menu ⋯ d’une ligne de fichier](img/file-ops.png)

## Renommer

Deux points d’entrée, un même ensemble de contrôles :

- **⋯ ▸ Renommer** sur une ligne de l’accueil.
- **Double-cliquez sur un onglet de fichier** pour renommer sur place (voir [Onglets et gestion des fenêtres](help://tabs-and-windows)).

Règles : l’extension est conservée automatiquement ; les caractères interdits, les points finais et les noms réservés (CON/NUL et consorts) sont refusés avec un message ; un conflit de nom dans le même dossier est également bloqué. Le vrai fichier sur le disque est renommé, et les récents et les favoris suivent.

## Supprimer

- **⋯ ▸ Supprimer** sur l’accueil : demande quels fichiers, puis les déplace vers la **corbeille du système**, où l’OS peut les restaurer. GenOffice ne conserve aucune annulation propre pour cela — la récupération relève de la corbeille, pas d’une notification.

## Dupliquer

**⋯ ▸ Dupliquer** crée une copie nommée « <name> copy » dans le même dossier ; les collisions reçoivent automatiquement un compteur. La copie rejoint les **Récents** au lieu de s’ouvrir : à un clic de vous, pas devant vous.

## Enregistrer et Enregistrer sous

- **⌘S / ctrl+S** enregistre le fichier courant ; un fichier sans titre demande d’abord l’emplacement et le nom.
- Dans la plupart des éditeurs, la liste des types de fichier de la boîte Enregistrer sous propose aussi les formats d’exportation (PDF, images, autres formats de document). En choisir un n’écrit qu’une copie ; le document ouvert et son onglet restent sur le fichier d’origine. Les images de plusieurs pages sont réparties en `nom-01.png`, `nom-02.png`, ….
- **Docs** : la liste Enregistrer sous propose aussi .hwp et .hwpx (Fichier ▸ Exporter en document HWP… fait de même). Si un élément ne peut pas être repris, comme des commentaires, des équations ou des zones de texte, vous en êtes averti avant l’écriture du fichier.
- **Enregistrer sous** écrit un nouveau fichier et laisse l’original intact ; les modifications suivantes ciblent le nouveau fichier.
- Chaque enregistrement est atomique (fichier temporaire puis renommage) ; quitter en cours d’écriture ne peut pas corrompre le fichier.
- L’enregistrement automatique suit le commutateur de chaque éditeur ; un nouveau document sans fichier ne commence qu’après sa première sauvegarde (voir [Démarrage rapide](help://getting-started)).

## Export en PDF

- **Docs** : Fichier ▸ Exporter en PDF (ou le bouton du ruban), paginé selon la mise en page courante.
- **Slides** : l’export rastérise page par page, avec progression pour les gros diaporamas.
- **Sheets** : l’export suit la pagination d’impression.
- Les exports sont rendus dans une fenêtre masquée et arrivent là où vous le choisissez.

## Export en Word / images

- **PDF ▸ PDF en Word** : transforme le PDF en .docx (conversion locale ; les mises en page complexes sont au mieux préservées).
- **Docs** peut exporter les pages en images (un PNG par page).

## Impression

Fichier ▸ Imprimer (⌘P/ctrl+P) ouvre une fenêtre d’impression dans chaque éditeur. Docs, PDF, Sheets, Slides et Markdown ont une section **Mise en page** dans leur fenêtre d’impression habituelle, HWP dans l’aperçu avant impression, et HTML, carte mentale et diagramme dans une nouvelle petite fenêtre d’impression. Si vous ne choisissez rien dans Mise en page, l’impression se fait comme avant.

- **Disposition** : choisissez Une page par feuille, Plusieurs pages par feuille (2, 4, 6, 9 ou 16), Livret (reliure à gauche ou à droite), Affiche (feuilles en largeur et en hauteur, chevauchement, lignes de coupe) ou Étiquettes (une page par étiquette ou même page sur chaque étiquette, étiquette de départ, format A4 courant ou dimensions personnalisées).
- **Faces impaires seulement, faces paires seulement, ordre inverse** : les faces sont comptées après la disposition, sur ce qui sort réellement de l’imprimante. Utile avec une imprimante sans recto verso : imprimez les rectos, retournez le papier, puis imprimez les versos.
- **Réduire pour tenir sur le papier** : seules les pages plus grandes que le papier choisi sont réduites ; les plus petites ne sont pas agrandies. Sheets et Markdown utilisent leurs propres réglages de papier et d’échelle.
- **Niveaux de gris et résolution des images** : quand vous imprimez avec des options de Mise en page, chaque page est convertie en image avant d’être envoyée à l’imprimante. Choisissez la résolution parmi Automatique, 150, 300 ou 600 dpi.
- **Sélection seulement** : Docs et Markdown impriment uniquement le texte sélectionné, remis en page à partir de la première page ; Slides imprime les diapositives sélectionnées et PDF les pages sélectionnées. Sheets imprime la plage sélectionnée comme avant.
- **Schéma de disposition et aperçu du résultat** : le schéma montre tout de suite où chaque numéro de page tombe sur la feuille, et **Aperçu du résultat** montre ce qui a réellement été produit. **Enregistrer le résultat disposé en PDF** permet d’imprimer la même disposition sur un autre PC ou chez un imprimeur.
- **Fenêtre d’impression du système** : pour un livret, choisissez le recto verso avec retournement sur le bord court. Laissez la plage de pages et le nombre de pages par feuille tels quels dans la fenêtre du système.

Les PDF s’impriment avec l’ordre de pages et les rotations courants.

## Où vivent les fichiers sans titre

L’emplacement que vous choisissez à la première sauvegarde est son domicile. Avant cela, le document n’a pas de fichier à lui : son contenu non enregistré n’existe que sous forme de copie de récupération dans le dossier de données de l’application, ce qui permet de le retrouver si l’application s’arrête brusquement (voir [Onglets et gestion des fenêtres](help://tabs-and-windows)). L’enregistrement automatique ne prend le relais qu’après cette première sauvegarde.
