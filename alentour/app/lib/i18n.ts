/**
 * Every user-facing string, FR and EN, in one place. French first: Montréal, Bill 96.
 * Retrofitting i18n later is a rewrite (docs/alentour/09-architecture.md), so nothing in a
 * screen should be a bare literal.
 */
import * as Localization from "expo-localization";

export type Lang = "fr" | "en";

const dict = {
  // navigation
  "nav.explore": { fr: "Explorer", en: "Explore" },
  "nav.saved": { fr: "Enregistrés", en: "Saved" },
  "nav.map": { fr: "Carte", en: "Map" },
  "nav.settings": { fr: "Réglages", en: "Settings" },
  "nav.back": { fr: "Retour", en: "Back" },

  // home
  "home.morning": { fr: "Ce matin", en: "This morning" },
  "home.afternoon": { fr: "Cet après-midi", en: "This afternoon" },
  "home.evening": { fr: "Ce soir", en: "Tonight" },
  "home.title": { fr: "Quoi faire proche", en: "What to do nearby" },
  "home.locate": { fr: "Montrer ce qui est vraiment proche de moi", en: "Show what's actually near me" },
  "home.approx": { fr: "Position approximative : Plateau", en: "Approximate: Plateau" },
  "home.search": { fr: "Chercher et filtrer", en: "Search and filter" },
  "home.everything": { fr: "Tout ce qu'il y a autour", en: "Everything around you" },
  "home.rainNote": { fr: "Pluie prévue — l'intérieur passe en premier.", en: "Rain expected — indoor goes first." },
  "home.coldNote": { fr: "Grand froid — on a trié en conséquence.", en: "Deep cold — sorted accordingly." },
  "home.darkNote": { fr: "Il fait noir — les belvédères attendront demain.", en: "It's dark — lookouts can wait for tomorrow." },
  "home.unavailable": { fr: "Catalogue indisponible", en: "Catalog unavailable" },
  "home.unavailableBody": {
    fr: "Vérifie ta connexion. Le catalogue se garde en mémoire une fois téléchargé.",
    en: "Check your connection. The catalog is cached once downloaded.",
  },

  // cards and facts
  "card.free": { fr: "Gratuit", en: "Free" },
  "card.from": { fr: "dès", en: "from" },
  "card.open": { fr: "Ouvert", en: "Open" },
  "card.closed": { fr: "Fermé", en: "Closed" },
  "card.hoursUnknown": { fr: "Horaire inconnu", en: "Hours unknown" },
  "card.a11yUnknown": { fr: "Accessibilité non vérifiée", en: "Accessibility not verified" },
  "card.save": { fr: "Enregistrer", en: "Save" },
  "card.unsave": { fr: "Retirer des enregistrés", en: "Remove from saved" },
  "effort.0": { fr: "Facile", en: "Easy" },
  "effort.1": { fr: "Facile", en: "Easy" },
  "effort.2": { fr: "Modéré", en: "Moderate" },
  "effort.3": { fr: "Exigeant", en: "Demanding" },
  "effort.4": { fr: "Difficile", en: "Hard" },

  // browse
  "browse.search": { fr: "Chercher…", en: "Search…" },
  "browse.results": { fr: "{n} résultats", en: "{n} results" },
  "browse.results_one": { fr: "{n} résultat", en: "{n} result" },
  "browse.nothing": { fr: "Rien à afficher", en: "Nothing to show" },
  "browse.noExact": { fr: "Aucun résultat exact", en: "No exact matches" },
  "browse.relaxed": { fr: "Voici {n} suggestions en ignorant {what}.", en: "Showing {n} results ignoring {what}." },
  "browse.and": { fr: " et ", en: " and " },
  "browse.unknownTitle": { fr: "Accessibilité non vérifiée", en: "Accessibility not verified" },
  "browse.unknownBody": {
    fr: "On ne sait pas encore. Ces lieux ne sont pas cachés pour autant.",
    en: "We don't know yet. These aren't hidden for that reason.",
  },
  "filter.maxDistanceKm": { fr: "la distance", en: "distance" },
  "filter.maxPriceCents": { fr: "le prix", en: "price" },
  "filter.categories": { fr: "la catégorie", en: "category" },
  "filter.tags": { fr: "l'ambiance", en: "vibe" },
  "filter.openNow": { fr: "ouvert maintenant", en: "open now" },
  "filter.maxDurationMinutes": { fr: "la durée", en: "duration" },
  "filter.maxPhysical": { fr: "l'effort", en: "effort" },
  "filter.maxSkill": { fr: "le niveau", en: "skill" },
  "filter.indoorOnly": { fr: "intérieur", en: "indoor" },
  "filter.minIcebreaker": { fr: "le côté social", en: "sociability" },
  "chip.distance": { fr: "Distance", en: "Distance" },
  "chip.free": { fr: "Gratuit", en: "Free" },
  "chip.openNow": { fr: "Ouvert", en: "Open now" },
  "chip.filters": { fr: "Filtres", en: "Filters" },

  // filter sheet
  "sheet.title": { fr: "Filtres", en: "Filters" },
  "sheet.reset": { fr: "Réinitialiser", en: "Reset" },
  "sheet.mood": { fr: "Envie de quoi ?", en: "In the mood for" },
  "sheet.category": { fr: "Catégorie", en: "Category" },
  "sheet.duration": { fr: "Durée maximale", en: "Max duration" },
  "sheet.effort": { fr: "Effort physique", en: "Physical effort" },
  "sheet.a11y": { fr: "Accessibilité", en: "Accessibility" },
  "sheet.a11yNote": {
    fr: "Les lieux non vérifiés apparaissent séparément plutôt que d'être cachés.",
    en: "Unverified places are shown separately rather than hidden.",
  },
  "sheet.any": { fr: "Peu importe", en: "Any" },
  "sheet.none": { fr: "Aucun", en: "None" },
  "sheet.light": { fr: "Léger", en: "Light" },
  "sheet.moderate": { fr: "Modéré", en: "Moderate" },
  "sheet.halfDay": { fr: "Demi-journée", en: "Half day" },
  "sheet.show": { fr: "Voir {n} résultats", en: "Show {n} results" },
  "sheet.show_one": { fr: "Voir {n} résultat", en: "Show {n} result" },

  // detail
  "detail.price": { fr: "Prix", en: "Price" },
  "detail.duration": { fr: "Durée", en: "Duration" },
  "detail.distance": { fr: "Distance", en: "Distance" },
  "detail.effort": { fr: "Effort", en: "Effort" },
  "detail.about": { fr: "À propos", en: "About" },
  "detail.bring": { fr: "Quoi apporter", en: "What to bring" },
  "detail.hours": { fr: "Horaire", en: "Hours" },
  "detail.a11y": { fr: "Accessibilité", en: "Accessibility" },
  "detail.a11yNone": { fr: "Aucune information", en: "No information" },
  "detail.a11yUnverified": { fr: "Non vérifié :", en: "Not verified:" },
  "detail.a11yCallAhead": {
    fr: "Non vérifié ne veut pas dire inaccessible. Appelle avant de te déplacer.",
    en: "Not verified doesn't mean inaccessible. Call ahead.",
  },
  "detail.tags": { fr: "Étiquettes", en: "Tags" },
  "detail.where": { fr: "Où", en: "Where" },
  "detail.verified": { fr: "Vérifié le {date}", en: "Verified {date}" },
  "detail.unverified": { fr: "Non vérifié", en: "Unverified" },
  "detail.saved": { fr: "★ Enregistré", en: "★ Saved" },
  "detail.save": { fr: "☆ Enregistrer", en: "☆ Save" },
  "detail.go": { fr: "Y aller", en: "Directions" },
  "detail.share": { fr: "Partager", en: "Share" },
  "detail.addToList": { fr: "Ajouter à une liste", en: "Add to a list" },
  "detail.report": { fr: "Signaler une erreur", en: "Report a problem" },
  "detail.notFound": { fr: "Activité introuvable", en: "Activity not found" },
  "detail.shareMessage": { fr: "{title} — trouvé sur Alentour", en: "{title} — found on Alentour" },

  // saved + lists
  "saved.empty": { fr: "Rien d'enregistré pour l'instant", en: "Nothing saved yet" },
  "saved.emptyBody": {
    fr: "Touche l'étoile sur une activité pour la garder ici. Ça marche hors ligne.",
    en: "Tap the star on an activity to keep it here. Works offline.",
  },
  "saved.all": { fr: "Tout", en: "All" },
  "lists.title": { fr: "Mes listes", en: "My lists" },
  "lists.new": { fr: "Nouvelle liste", en: "New list" },
  "lists.namePlaceholder": { fr: "Ex. : Jours de pluie", en: "E.g. Rainy days" },
  "lists.create": { fr: "Créer", en: "Create" },
  "lists.count": { fr: "{n} activités", en: "{n} activities" },
  "lists.count_one": { fr: "{n} activité", en: "{n} activity" },
  "lists.delete": { fr: "Supprimer la liste", en: "Delete list" },
  "lists.done": { fr: "Terminé", en: "Done" },

  // report
  "report.title": { fr: "Qu'est-ce qui cloche ?", en: "What's wrong?" },
  "report.closed": { fr: "Fermé définitivement", en: "Permanently closed" },
  "report.hours": { fr: "Mauvais horaire", en: "Wrong hours" },
  "report.price": { fr: "Mauvais prix", en: "Wrong price" },
  "report.a11y": { fr: "Accessibilité inexacte", en: "Wrong accessibility info" },
  "report.missing": { fr: "N'existe pas", en: "Doesn't exist" },
  "report.dangerous": { fr: "Dangereux", en: "Dangerous" },
  "report.other": { fr: "Autre chose", en: "Something else" },
  "report.details": { fr: "Détails (facultatif)", en: "Details (optional)" },
  "report.send": { fr: "Envoyer", en: "Send" },
  "report.thanks": { fr: "Merci ! On vérifie.", en: "Thanks! We'll check." },
  "report.cancel": { fr: "Annuler", en: "Cancel" },

  // map
  "map.fallbackTitle": { fr: "Carte indisponible ici", en: "Map unavailable here" },
  "map.fallbackBody": {
    fr: "La carte a besoin de l'app installée (pas Expo Go). Voici la liste, du plus proche au plus loin.",
    en: "The map needs the installed app (not Expo Go). Here is the list, nearest first.",
  },

  // settings
  "settings.language": { fr: "Langue", en: "Language" },
  "settings.langAuto": { fr: "Selon l'appareil", en: "Device default" },
  "settings.location": { fr: "Position", en: "Location" },
  "settings.locationOn": { fr: "Position précise activée", en: "Precise location on" },
  "settings.locationOff": { fr: "Position approximative (Plateau)", en: "Approximate location (Plateau)" },
  "settings.locationEnable": { fr: "Utiliser ma position", en: "Use my location" },
  "settings.locationNote": {
    fr: "Ta position sert seulement à trier ce qui est proche. Elle n'est ni stockée ni partagée.",
    en: "Your location is only used to sort what's nearby. It is never stored or shared.",
  },
  "settings.data": { fr: "Données", en: "Data" },
  "settings.catalog": { fr: "Catalogue : {n} activités, mis à jour le {date}", en: "Catalog: {n} activities, updated {date}" },
  "settings.catalog_one": { fr: "Catalogue : {n} activité, mise à jour le {date}", en: "Catalog: {n} activity, updated {date}" },
  "settings.credits": { fr: "Sources et crédits", en: "Sources and credits" },
  "settings.creditsBody": {
    fr: "Lieux : Overture Maps Foundation (CDLA-Permissive 2.0) et contributeurs OpenStreetMap (ODbL). Données ouvertes de la Ville de Montréal. Météo : Open-Meteo (CC BY 4.0).",
    en: "Places: Overture Maps Foundation (CDLA-Permissive 2.0) and OpenStreetMap contributors (ODbL). City of Montréal open data. Weather: Open-Meteo (CC BY 4.0).",
  },
  "settings.privacy": { fr: "Confidentialité", en: "Privacy" },
  "settings.version": { fr: "Version {v}", en: "Version {v}" },

  // account
  "account.title": { fr: "Compte", en: "Account" },
  "account.pitch": {
    fr: "Retrouve tes enregistrés et tes listes sur tous tes appareils.",
    en: "Keep your saves and lists across all your devices.",
  },
  "account.signIn": { fr: "Se connecter", en: "Sign in" },
  "account.signedInAs": { fr: "Connecté : {email}", en: "Signed in: {email}" },
  "account.syncing": { fr: "Synchronisation…", en: "Syncing…" },
  "account.synced": { fr: "À jour sur tous tes appareils", en: "Up to date on all your devices" },
  "account.syncError": { fr: "Hors ligne — on réessaiera", en: "Offline — will retry" },
  "account.export": { fr: "Exporter mes données", en: "Export my data" },
  "account.signOut": { fr: "Se déconnecter", en: "Sign out" },
  "account.delete": { fr: "Supprimer mon compte", en: "Delete my account" },
  "account.deleteConfirm": {
    fr: "Ton compte, tes listes et tes enregistrés seront effacés. C'est définitif.",
    en: "Your account, lists and saves will be erased. This cannot be undone.",
  },
  "account.deleted": { fr: "Compte supprimé.", en: "Account deleted." },
  "signin.title": { fr: "Connexion", en: "Sign in" },
  "signin.emailLabel": { fr: "Ton courriel", en: "Your email" },
  "signin.sendCode": { fr: "Recevoir un code", en: "Send me a code" },
  "signin.codeSent": { fr: "Code envoyé à {email}", en: "Code sent to {email}" },
  "signin.codeLabel": { fr: "Code à 6 chiffres", en: "6-digit code" },
  "signin.verify": { fr: "Se connecter", en: "Sign in" },
  "signin.resend": { fr: "Renvoyer le code", en: "Resend code" },
  "signin.changeEmail": { fr: "Changer de courriel", en: "Use a different email" },
  "signin.privacy": {
    fr: "Pas de mot de passe. On garde seulement ton courriel, jamais ta position.",
    en: "No password. We only keep your email — never your location.",
  },
  "error.invalid_email": { fr: "Ce courriel ne semble pas valide.", en: "That email doesn't look right." },
  "error.invalid_code": { fr: "Code incorrect.", en: "Wrong code." },
  "error.expired": { fr: "Ce code a expiré. Demandes-en un nouveau.", en: "That code expired. Ask for a new one." },
  "error.too_many_attempts": { fr: "Trop d'essais. Demande un nouveau code.", en: "Too many tries. Ask for a new code." },
  "error.rate_limited": { fr: "Trop de demandes. Réessaie dans un moment.", en: "Too many requests. Try again shortly." },
  "error.network": { fr: "Pas de connexion. Réessaie.", en: "No connection. Try again." },
  "error.generic": { fr: "Quelque chose a mal tourné. Réessaie.", en: "Something went wrong. Try again." },

  // community (Stage 6)
  "nav.add": { fr: "Ajouter une activité", en: "Add an activity" },
  "add.intro": {
    fr: "Tu connais une butte à glisser, un marché du mardi, un coin secret pour le coucher du soleil ? Ajoute-le. On vérifie les premiers ajouts de chaque personne avant de les publier.",
    en: "Know a sledding hill, a Tuesday market, a secret sunset spot? Add it. We check each person's first additions before publishing them.",
  },
  "add.title": { fr: "Nom de l'activité", en: "Activity name" },
  "add.description": { fr: "Ce qu'on y fait (facultatif)", en: "What you do there (optional)" },
  "add.category": { fr: "Catégorie", en: "Category" },
  "add.suggest": { fr: "Suggérer des étiquettes", en: "Suggest tags" },
  "add.tags": { fr: "Étiquettes (3 max) — touche pour retirer", en: "Tags (3 max) — tap to remove" },
  "add.where": { fr: "Où", en: "Where" },
  "add.atVenue": { fr: "Dans un lieu du catalogue", en: "At a place in the catalog" },
  "add.here": { fr: "Ici, à ma position", en: "Right here, at my location" },
  "add.placeName": { fr: "Nom de l'endroit (ex. : Parc Jarry, la butte)", en: "Place name (e.g. Jarry Park, the hill)" },
  "add.needLocation": { fr: "Active ta position précise pour épingler l'endroit.", en: "Turn on precise location to pin the place." },
  "add.searchVenue": { fr: "Chercher un lieu…", en: "Search a place…" },
  "add.free": { fr: "Gratuit", en: "Free" },
  "add.submit": { fr: "Envoyer", en: "Submit" },
  "add.similar": { fr: "C'est peut-être déjà là :", en: "This might already be here:" },
  "add.different": { fr: "Non, c'est autre chose — envoyer quand même", en: "No, it's something else — submit anyway" },
  "add.published": { fr: "Publié ! Merci — ce sera dans l'app à la prochaine mise à jour.", en: "Published! Thanks — it'll be in the app with the next update." },
  "add.pending": { fr: "Merci ! On vérifie et on te prévient quand c'est publié.", en: "Thanks! We'll check it and let you know when it's live." },
  "add.privacy": { fr: "Jamais d'adresse résidentielle ni d'endroit privé. Pas de toits, de chantiers ni de bâtiments abandonnés.", en: "Never a home address or private property. No rooftops, construction sites or abandoned buildings." },
  "error.duplicate": { fr: "Ça ressemble à une activité existante.", en: "This looks like an existing activity." },
  "error.prohibited": { fr: "On ne peut pas publier ce genre d'activité.", en: "We can't list this kind of activity." },
  "error.outside_city": { fr: "Alentour couvre seulement Montréal pour l'instant.", en: "Alentour only covers Montréal for now." },
  "error.invalid": { fr: "Vérifie les champs.", en: "Check the fields." },
  "detail.book": { fr: "Réserver", en: "Book" },
  "detail.stillAccurate": { fr: "Cette fiche est-elle encore exacte ?", en: "Is this listing still accurate?" },
  "detail.accurateYes": { fr: "Oui", en: "Yes" },
  "detail.accurateNo": { fr: "Plus maintenant", en: "Not anymore" },
  "detail.accurateThanks": { fr: "Merci, ça aide tout le monde.", en: "Thanks, that helps everyone." },
  // outings (Stage 5)
  "nav.outings": { fr: "Sorties", en: "Outings" },
  "outings.title": { fr: "Sorties", en: "Outings" },
  "outings.intro": {
    fr: "Des sorties en petit groupe (8 max), toujours dans un lieu public du catalogue. Alentour organise; Alentour ne vérifie pas les participants.",
    en: "Small-group outings (8 max), always at a public venue from the catalog. Alentour organizes; Alentour does not vet participants.",
  },
  "outings.needApi": { fr: "Les sorties arrivent bientôt.", en: "Outings are coming soon." },
  "outings.signIn": { fr: "Connecte-toi pour voir les sorties.", en: "Sign in to see outings." },
  "outings.setup": { fr: "Configurer ma participation", en: "Set up to take part" },
  "outings.paused": { fr: "Les sorties sont en pause pour le moment.", en: "Outings are paused for now." },
  "outings.mine": { fr: "Mes sorties", en: "My outings" },
  "outings.invites": { fr: "Invitations à voter", en: "Invitations to vote" },
  "outings.week": { fr: "Cette semaine", en: "This week" },
  "outings.empty": { fr: "Rien de prévu pour l'instant. Enregistre des activités : quand quelques personnes enregistrent la même, Alentour propose un moment.", en: "Nothing planned yet. Save activities: when a few people save the same one, Alentour suggests a time." },
  "outings.going": { fr: "{n}/{cap} y vont", en: "{n}/{cap} going" },
  "outings.voting": { fr: "Vote en cours", en: "Voting" },
  "outings.mode.venue_session": { fr: "Organisé par le lieu", en: "Run by the venue" },
  "outings.mode.rally": { fr: "Proposé par Alentour", en: "Suggested by Alentour" },
  "outings.mode.rally_user": { fr: "Proposé par un membre", en: "Suggested by a member" },
  "outings.mode.fixed": { fr: "Proposé par un membre", en: "Hosted by a member" },
  "outings.status.paused": { fr: "En pause — un signalement est en cours de vérification", en: "Paused — a report is being reviewed" },
  "outings.join": { fr: "J'y vais", en: "I'm going" },
  "outings.leave": { fr: "Je n'y vais plus", en: "I'm not going anymore" },
  "outings.youreGoing": { fr: "Tu y vas ✓", en: "You're going ✓" },
  "outings.full": { fr: "Complet", en: "Full" },
  "outings.voteTitle": { fr: "Quel moment te convient ?", en: "Which time works for you?" },
  "outings.voteHint": { fr: "Si au moins {q} personnes disent oui au même moment, c'est confirmé le {date}.", en: "If at least {q} people say yes to the same time, it's on. Decided {date}." },
  "outings.yes": { fr: "Oui", en: "Yes" },
  "outings.maybe": { fr: "Peut-être", en: "Maybe" },
  "outings.no": { fr: "Non", en: "No" },
  "outings.tally": { fr: "{yes} oui · {maybe} peut-être", en: "{yes} yes · {maybe} maybe" },
  "outings.chat": { fr: "Discussion du groupe", en: "Group chat" },
  "outings.chatClosed": { fr: "La discussion ouvre quand la sortie est confirmée, et ferme 48 h après.", en: "The chat opens when the outing is confirmed and closes 48 h after." },
  "outings.chatPlaceholder": { fr: "Écrire au groupe…", en: "Message the group…" },
  "outings.send": { fr: "Envoyer", en: "Send" },
  "outings.alentour": { fr: "Alentour", en: "Alentour" },
  "outings.held": { fr: "Message retenu pour vérification", en: "Message held for review" },
  "outings.contactDetails": { fr: "Pas de numéros, courriels ou liens ici : échangez-les en personne.", en: "No numbers, emails or links here: swap them in person." },
  "outings.report": { fr: "Signaler cette sortie", en: "Report this outing" },
  "outings.reportMessage": { fr: "Signaler", en: "Report" },
  "outings.block": { fr: "Bloquer", en: "Block" },
  "outings.blocked": { fr: "Bloqué. Vous ne verrez plus les sorties de l'autre, et on ne lui dit rien.", en: "Blocked. You won't see each other's outings, and they aren't told." },
  "outings.reported": { fr: "Merci. La sortie est en pause le temps qu'on vérifie.", en: "Thanks. The outing is paused while we check." },
  "outings.checkin": { fr: "Je suis arrivé·e", en: "I'm here" },
  "outings.checkedIn": { fr: "Arrivée confirmée ✓", en: "Checked in ✓" },
  "outings.rate": { fr: "Comment c'était ?", en: "How was it?" },
  "outings.again": { fr: "Je le referais", en: "I'd do it again" },
  "outings.thanks": { fr: "Merci !", en: "Thanks!" },
  "outings.safety": {
    fr: "Rendez-vous dans le lieu, pas ailleurs. Alentour ne vérifie pas les participants. En cas de problème, signale-le : la sortie se met en pause tout de suite.",
    en: "Meet at the venue, nowhere else. Alentour does not vet participants. If anything's wrong, report it: the outing pauses right away.",
  },
  "outings.withOthers": { fr: "Y aller avec du monde", en: "Go with others" },
  "outings.none": { fr: "Aucune sortie prévue ici.", en: "No outings planned here." },
  "outings.propose": { fr: "Proposer une sortie", en: "Suggest an outing" },
  "outings.proposed": { fr: "Proposé ! {n} personnes qui l'ont enregistré sont invitées à voter.", en: "Suggested! {n} people who saved it are invited to vote." },
  "outings.proposed_one": { fr: "Proposé ! {n} personne qui l'a enregistré est invitée à voter.", en: "Suggested! {n} person who saved it is invited to vote." },
  "error.not_enough_interest": {
    fr: "Pas encore assez de monde intéressé. Enregistre l'activité : quand quelques personnes l'auront enregistrée, Alentour proposera un moment.",
    en: "Not enough people interested yet. Save it: once a few people have, Alentour will suggest a time.",
  },
  "error.ineligible": { fr: "Configure d'abord ta participation (âge et téléphone).", en: "Set up first (age and phone)." },
  "error.paused": { fr: "En pause pour le moment.", en: "Paused for now." },
  "error.full": { fr: "C'est complet.", en: "It's full." },
  "error.closed": { fr: "Ce n'est plus possible.", en: "That's no longer possible." },
  "error.no_slots": { fr: "Pas de moment possible selon les heures d'ouverture.", en: "No time fits the opening hours." },
  "error.too_risky": { fr: "Cette activité ne peut pas être organisée entre membres.", en: "This activity can't be organized between members." },
  "error.contact_details": { fr: "Pas de numéros, courriels ou liens : échangez-les en personne.", en: "No numbers, emails or links: swap them in person." },
  "setup.title": { fr: "Participer aux sorties", en: "Take part in outings" },
  "setup.why": {
    fr: "Des inconnus qui se rencontrent : on garde ça simple et sûr. 18 ans et plus seulement, un numéro de téléphone vérifié par personne, 8 personnes maximum, toujours dans un lieu public.",
    en: "Strangers meeting up: we keep it simple and safe. 18+ only, one verified phone number per person, 8 people max, always at a public venue.",
  },
  "setup.birthYear": { fr: "Année de naissance", en: "Birth year" },
  "setup.adult": { fr: "J'ai 18 ans ou plus", en: "I am 18 or older" },
  "setup.saveAge": { fr: "Confirmer", en: "Confirm" },
  "setup.ageDone": { fr: "Âge confirmé ✓", en: "Age confirmed ✓" },
  "setup.phone": { fr: "Numéro de cellulaire", en: "Mobile number" },
  "setup.phoneWhy": { fr: "Jamais montré aux autres. Il sert seulement à éviter les faux comptes.", en: "Never shown to others. It only keeps out fake accounts." },
  "setup.sendCode": { fr: "Recevoir un code par texto", en: "Text me a code" },
  "setup.code": { fr: "Code reçu par texto", en: "Code from the text" },
  "setup.verify": { fr: "Vérifier", en: "Verify" },
  "setup.phoneDone": { fr: "Téléphone vérifié : {phone}", en: "Phone verified: {phone}" },
  "setup.optIn": { fr: "Alentour peut m'inviter quand d'autres enregistrent les mêmes activités que moi", en: "Alentour may invite me when others save the same activities as me" },
  "setup.optInHint": { fr: "Personne ne voit ce que tu as enregistré : seulement combien de personnes l'ont fait.", en: "Nobody sees what you saved — only how many people did." },
  "setup.done": { fr: "C'est prêt. Bonne sortie !", en: "You're all set. Have fun!" },
  "error.invalid_phone": { fr: "Ce numéro ne semble pas valide (Canada ou États-Unis).", en: "That number doesn't look right (Canada or US)." },
  "error.phone_in_use": { fr: "Ce numéro est déjà utilisé par un autre compte.", en: "That number is already used by another account." },
} as const;

export type Key = keyof typeof dict;

/**
 * Singular form, per language. French treats 0 and 1 as singular ("0 résultat"); English only 1.
 * A key with a `_one` sibling switches to it automatically when `vars.n` is singular.
 */
function isSingular(n: number, lang: Lang): boolean {
  return lang === "fr" ? Math.abs(n) < 2 : n === 1;
}

export function translate(key: Key, lang: Lang, vars?: Record<string, string | number>): string {
  const n = vars?.n;
  const oneKey = `${key}_one` as Key;
  const useOne = typeof n === "number" && isSingular(n, lang) && oneKey in dict;
  let s: string = dict[useOne ? oneKey : key][lang];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Device language, narrowed to what we ship. Anything that isn't English gets French. */
export function deviceLang(): Lang {
  try {
    const code = Localization.getLocales()[0]?.languageCode ?? "fr";
    return code === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

export const localeOf = (lang: Lang) => (lang === "fr" ? "fr-CA" : "en-CA");
