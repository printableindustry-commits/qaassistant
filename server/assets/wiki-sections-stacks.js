/**
 * Wiki — sections stacks 10 à 13 (agrégateur).
 * Contenu détaillé : wiki-stack-cypress.js, wiki-stack-robot.js, wiki-stack-playwright.js, wiki-stack-postman.js
 */
// eslint-disable-next-line no-var
var WikiStackSections = [
  typeof WikiStackCypress !== 'undefined' ? WikiStackCypress : null,
  typeof WikiStackRobot !== 'undefined' ? WikiStackRobot : null,
  typeof WikiStackPlaywright !== 'undefined' ? WikiStackPlaywright : null,
  typeof WikiStackPostman !== 'undefined' ? WikiStackPostman : null,
  typeof WikiStackK6 !== 'undefined' ? WikiStackK6 : null,
].filter(Boolean)
