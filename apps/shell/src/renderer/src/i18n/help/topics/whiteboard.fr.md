# Tableau blanc : remue-méninges, croquis et annotations

L'éditeur de tableau blanc ouvre les fichiers `.whiteboard` dans un onglet. Vous pouvez disposer des pense-bêtes, du texte, des formes, des connecteurs, des tableaux, des autocollants, des images, des cartes de lien et des tracés à main levée sur des tableaux infinis ou des pages fixes, importer des pages PDF en arrière-plan, exporter en image ou PDF et travailler avec le panneau IA. Tout fonctionne localement sur votre PC.

## Ouvrir et créer

- Un nouveau tableau démarre en mode libre infini depuis la vignette **Tableau blanc** de l'accueil ou via Nouveau dans le menu Fichier.
- L'éditeur ouvre les fichiers `.whiteboard` depuis la boîte d'ouverture, par glisser-déposer dans la fenêtre, depuis les fichiers récents, l'arborescence, l'aperçu rapide (Espace) ou Google Drive. Sous Windows, l'installation de GenOffice l'enregistre par défaut pour `.whiteboard`.
- Les fichiers Excalidraw (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) s'importent comme nouveau tableau sans titre. Le fichier d'origine n'est jamais écrasé, la fermeture sans modification ne demande pas d'enregistrer et le premier enregistrement propose `.whiteboard` dans le même dossier. Les éléments non pris en charge comme les intégrations web sont ignorés et leur nombre s'affiche dans un bandeau. Sous Windows, `.excalidraw` apparaît uniquement dans « Ouvrir avec ».
- Si le tableau est déjà ouvert, son onglet passe au premier plan.

## Édition et outils

- Un même fichier `.whiteboard` peut mélanger tableaux libres et pages fixes (écran 16:9, A4 portrait ou paysage et formats de pages PDF personnalisés) dans la barre de pages.
- Les outils comprennent la sélection, les pense-bêtes, le texte enrichi, huit formes, les connecteurs et flèches, le stylo sensible à la pression, le surligneur et la gomme, les images, les tableaux, les autocollants intégrés et les cartes de lien.
- Pour sélectionner plusieurs objets à la fois, faites glisser un rectangle depuis un endroit vide avec l'outil de sélection. Si les objets ne laissent aucun endroit vide, choisissez **Sélectionner une zone** (M) dans la barre d'outils de gauche et commencez le glissement directement sur les objets. Seuls les objets entièrement contenus dans le rectangle sont sélectionnés. Maj+clic (ou Ctrl+clic) sur un objet l'ajoute à la sélection ou l'en retire, un glissement avec Maj ajoute les objets d'un autre rectangle, et Ctrl+A (⌘A sur Mac) sélectionne tous les objets de la page actuelle. Faire glisser l'un des objets sélectionnés les déplace tous ensemble, et Premier plan, Arrière-plan, Dupliquer et Supprimer s'appliquent à tous, chacun en une seule étape d'annulation.
- Glissez un fichier `.pdf` sur un tableau ouvert ou choisissez **Importer un PDF** pour transformer les pages choisies en fonds fixes sur lesquels dessiner et annoter. Ouvrir un `.pdf` depuis l'accueil ou le menu Fichier l'ouvre toujours dans l'éditeur PDF.
- Appuyez sur F5 ou cliquez sur **Présenter** pour afficher le tableau en plein écran et changer de page avec les flèches.
- En thème sombre, les barres d'outils, panneaux et le fond autour de la page s'assombrissent, tandis que le papier, les pense-bêtes, les formes et l'encre gardent leurs couleurs d'origine.

## Enregistrer, exporter et imprimer

- L'enregistrement, Enregistrer sous, l'enregistrement automatique, les copies de récupération et la détection de conflit en vue partagée fonctionnent comme dans les autres éditeurs. Sans changement, le fichier n'est pas réécrit.
- Exportez en PNG, SVG ou PDF pour **Toutes les pages** ou **Page active uniquement**. Sur un tableau libre, l'export et l'impression englobent tous les objets avec une marge, ou la zone de départ s'il est vide.
- L'impression (Ctrl+P) prend en charge l'impression standard et la mise en page avancée. Les exports et impressions sont identiques en thème clair et sombre.

## Panneau IA

- Demandez à l'IA d'organiser les pense-bêtes, de créer un modèle d'atelier ou de rétrospective, d'ajouter des formes, connecteurs, tableaux ou images, ou de résumer le tableau.
- L'IA reçoit un tableau texte structuré et, lorsque le modèle choisi accepte les images, joint automatiquement une image de la page active. Les modèles texte uniquement fonctionnent avec le tableau texte seul.
- Chaque appel de modification de l'IA correspond à une seule étape d'annulation (Ctrl+Z), surligne les objets modifiés à l'écran sans toucher au fichier enregistré et propose **Annuler ces modifications** sur la carte de réponse.
- Les fichiers `.whiteboard` peuvent être joints dans les panneaux IA des autres éditeurs, mentionnés avec `@`, recherchés à l'accueil, utilisés dans **Créer un autre document** (y compris la conversion en Markdown sans IA) et traités par les [commandes du terminal](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`).

## Utilisation d'internet et cartes de lien

- L'ouverture, l'édition, l'export, l'impression et l'import Excalidraw ou PDF n'envoient aucune donnée sur internet.
- Cliquer sur une carte de lien ouvre les adresses `http`, `https` ou `mailto` dans votre navigateur par défaut.
- GenOffice ne se connecte une seule fois à la page cible pour enregistrer le titre et l'aperçu dans le fichier `.whiteboard` que si vous activez explicitement **Récupérer le titre et l'image d'aperçu** lors de l'ajout ou de la modification d'une carte.
