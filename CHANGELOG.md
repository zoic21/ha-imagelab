# Nouveautés d’Image Lab

## 0.3.1

- **Comparaison d’images.** La ligne « Référence la plus proche » affiche la vignette, le libellé et le lien vers la référence. La pastille d’état apparaît une seule fois, sur la ligne qui déplie les scores.
- **Liste des analyses.** Un espace de 4 px sépare le nom de chaque analyse de son sous-titre.

## 0.3.0

- **Résultats d’analyse.** Le bouton « Tester » est aligné avec le titre et la date apparaît juste en dessous. Les quatre types d’analyse présentent leurs résultats sous l’image.
- **Détection d’objets.** Chaque type d’objet a sa couleur. Le cadre sur l’image et la pastille qui indique le nom de l’objet et son score utilisent la même couleur.
- **Comparaison d’images.** Un clic sur la pastille d’état déplie les scores sous la capture. Les scores et les panneaux de référence se déplient sans surbrillance.
- **Palette et compteur.** Les couleurs extraites et leurs codes s’affichent sous la capture. La lecture du compteur apparaît dans une pastille avec son unité.
- **Configuration.** Sur ordinateur, les onglets avec icônes sont centrés en haut de la page et la flèche de retour reste à gauche. Le bouton flottant « Enregistrer » apparaît lorsqu’un réglage est modifié.

## 0.2.0

- **Comparaison d’images.** La référence la plus proche apparaît en légende sous la capture analysée. Sa vignette, son état et un lien permettent de retrouver la photo dans la galerie.
- **Réglages.** Le panneau affiche un aperçu de la source et regroupe les réglages de publication de l’entité. Sur mobile, les onglets sont accessibles en bas de l’écran.
- **Confirmation des changements.** La seconde lecture, lorsqu’elle est configurée, s’applique aux analyses planifiées par Image Lab. Les tests depuis le panneau et les analyses lancées par une action ou une automatisation rendent leur résultat dès la première lecture.
- Sur ordinateur et sur mobile, l’accueil regroupe les analyses par type avec leur dernière vignette. Les captures verticales restent dans leur ligne.
- Les formulaires ouverts depuis le panneau pour créer ou renommer une analyse ne font plus apparaître Image Lab parmi les intégrations découvertes.
- **Analyses de caméra.** Image Lab évite un décodage redondant à chaque analyse. Les zones de palette et de détection sont archivées à leur résolution d’origine, avec une compression sans perte plus rapide pour les captures en couleur.
- **Métadonnées des captures.** Pour lire la palette, le relevé du compteur ou les objets détectés, utilisez `GET /api/image_lab/preview/{profile_id}/{image_id}?metadata=1`. Le JSON inclut les dimensions, la date et le résultat. Les clients qui lisaient les en-têtes `X-Image-Lab-*` de l’aperçu peuvent utiliser l’identifiant de capture fourni par son `ETag`.
- **Clients externes.** L’ancien `POST /api/image_lab/preview/{profile_id}` est retiré. Pour lancer une analyse, utilisez l’action Home Assistant `image_lab.analyze` ou la commande WebSocket `image_lab/test_source` avec `profile_id`. Pour régler la fréquence d’une caméra, remplacez `image_lab/set_schedule` par `image_lab/set_publication`, avec `profile_id` et `settings.interval_minutes`.

## 0.1.0

Première version stable d’Image Lab pour Home Assistant. Les images sont analysées localement et les résultats peuvent déclencher vos automatisations.

- **Comparaison d’images.** Apprenez plusieurs états à partir de photos de référence, par exemple « volet ouvert » et « volet fermé ». Vous pouvez corriger une capture depuis l’historique et demander une seconde lecture avant de publier un changement.
- **Couleurs et objets.** Récupérez les couleurs d’une pochette quand le morceau change, ou détectez et comptez des objets dans une zone de l’image d’une caméra.
- **Compteurs mécaniques.** Cadrez les rouleaux et les aiguilles, confirmez l’index de départ et suivez les relevés dans Home Assistant.
- **Configuration.** Le panneau Image Lab réunit les réglages, les tests et l’historique. Les zones se dessinent à la souris ou au doigt.

Installation via HACS en ajoutant `zoic21/ha-imagelab` comme dépôt personnalisé de catégorie **Intégration**. Home Assistant Core **2026.10.4** ou ultérieur est requis.
