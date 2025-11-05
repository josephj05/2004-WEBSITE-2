// ============================================================
// Fridge2Table main script
// - Handles ingredient search, API calls to TheMealDB,
//   sorting/filtering, favorites, modal details, and contrast mode.
// ============================================================

// ----- DOM references ----------------------------------------------------

// Core search form and input
const form = document.getElementById("search-form");
const ingredientsInput = document.getElementById("ingredients-input");

// Status and results summary
const statusMessage = document.getElementById("status-message");
const resultsCount = document.getElementById("results-count");
const resultsQuery = document.getElementById("results-query");

// Filter/sort controls
const sortSelect = document.getElementById("sort-select");
const fastOnlyCheckbox = document.getElementById("fast-only");
const favoritesOnlyCheckbox = document.getElementById("favorites-only");

// Results container
const resultsGrid = document.getElementById("results-grid");

// Loading and modal UI
const loadingSpinner = document.getElementById("loading-spinner");
const modalOverlay = document.getElementById("modal-overlay");
const modalContent = document.getElementById("modal-content");
const modalCloseBtn = document.getElementById("modal-close-btn");

// Extra controls
const randomBtn = document.getElementById("random-ingredients-btn");
const contrastToggle = document.getElementById("contrast-toggle");
const toggleStatusBtn = document.getElementById("toggle-status-btn");
const searchPanel = document.getElementById("search-panel");

// ----- State -------------------------------------------------------------

// Full list of recipes from the most recent successful search
let allRecipes = [];

// Last user-facing query string (e.g. "chicken, rice")
let lastQueryText = "";

// LocalStorage keys
const FAVORITES_STORAGE_KEY = "f2t_favorites";
const CONTRAST_STORAGE_KEY = "f2t_contrast";

// IDs of recipes saved as favorites
let favorites = [];

// Modal focus management
let lastFocusedElement = null;
let isModalOpen = false;

// Pool of ingredients used for random search suggestions
const RANDOM_INGREDIENTS_POOL = [
  "chicken",
  "beef",
  "pork",
  "egg",
  "rice",
  "lime",
  "bread",
  "tomato",
  "onion",
  "garlic",
  "cheese",
  "Butter",
  "spinach",
  "pepper",
  "salmon",
  "tofu",
  "sugar",
  "potatoes",
  "bacon"
];

// Ingredients that do not change between singular/plural
const NO_PLURAL_CHANGE = new Set([
  "fish",
  "beef",
  "tofu",
  "rice",
  "pork",
  "salmon",
  "shrimp",
  "bacon",
  "bread"
]);

// ----- Favorites helpers -------------------------------------------------

// Load favorites from localStorage into memory
function loadFavorites() {
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    favorites = Array.isArray(parsed) ? parsed : [];
  } catch {
    favorites = [];
  }
}

// Persist favorites array back to localStorage
function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // localStorage may be blocked; ignore and keep in-memory state only
  }
}

// Check if a recipe is currently in favorites
function isFavorite(id) {
  return favorites.includes(id);
}

// Toggle favorite status for a recipe ID
function toggleFavorite(id) {
  if (isFavorite(id)) {
    favorites = favorites.filter((favId) => favId !== id);
  } else {
    favorites.push(id);
  }
  saveFavorites();
}

// Create a favorite button for a recipe card
function buildFavoriteButton(recipeId) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn favorite-btn";
  updateFavoriteButtonAppearance(btn, recipeId);

  btn.addEventListener("click", (event) => {
    // Avoid triggering any click on the main card button
    event.stopPropagation();
    toggleFavorite(recipeId);
    updateFavoriteButtonAppearance(btn, recipeId);
  });

  return btn;
}

// Update favorite button state (active/inactive)
function updateFavoriteButtonAppearance(btn, id) {
  const fav = isFavorite(id);
  btn.classList.toggle("is-active", fav);
  btn.setAttribute("aria-pressed", fav ? "true" : "false");
  btn.textContent = fav ? "★ Favorite" : "☆ Save";
  btn.title = fav ? "Remove from favorites" : "Save to favorites";
}

// ----- Contrast mode helpers --------------------------------------------

// Apply / remove contrast mode styles on the <body>
function applyContrastMode(enabled) {
  if (enabled) {
    document.body.classList.add("contrast-mode");
  } else {
    document.body.classList.remove("contrast-mode");
  }

  // Update button UI state
  if (contrastToggle) {
    contrastToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    contrastToggle.textContent = enabled
      ? "Disable eye comfort mode"
      : "Enable eye comfort mode";
  }
}

// Initialize contrast mode from localStorage and wire up the toggle button
function initContrastMode() {
  let stored = null;
  try {
    stored = localStorage.getItem(CONTRAST_STORAGE_KEY);
  } catch {
    stored = null;
  }

  const enabled = stored === "true";
  applyContrastMode(enabled);

  if (contrastToggle) {
    contrastToggle.addEventListener("click", () => {
      const nowEnabled = !document.body.classList.contains("contrast-mode");
      applyContrastMode(nowEnabled);
      try {
        localStorage.setItem(CONTRAST_STORAGE_KEY, String(nowEnabled));
      } catch {
        // ignore storage errors
      }
    });
  }
}

// ----- UI helpers --------------------------------------------------------

// Update the small status text under the search box
function setStatus(message, type = "info") {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.className = `status-message status-${type}`;
}

// Update the "Using: X · Y idea(s) found" summary
function updateSummary(currentCount) {
  if (!resultsCount || !resultsQuery) return;
  resultsCount.textContent = currentCount.toString();
  resultsQuery.textContent = lastQueryText || "—";
}

// Show the loading spinner
function showLoading() {
  if (!loadingSpinner) return;
  loadingSpinner.classList.remove("hidden");
  loadingSpinner.setAttribute("aria-busy", "true");
}

// Hide the loading spinner
function hideLoading() {
  if (!loadingSpinner) return;
  loadingSpinner.classList.add("hidden");
  loadingSpinner.setAttribute("aria-busy", "false");
}

// Remove all current recipe cards from the grid
function clearResults() {
  if (!resultsGrid) return;
  resultsGrid.innerHTML = "";
}

// Very rough time estimate: infer prep time from title length
function estimateMinutesFromName(name) {
  if (!name) return 25;
  const base = 15;
  const extra = Math.min(20, Math.floor(name.length / 3));
  return base + extra;
}

// Helper to label "quick" meals for the quick filter
function isQuickMeal(minutes) {
  return minutes <= 20;
}

// ----- Modal helpers (with focus trap) -----------------------------------

// Open the modal and trap focus inside it
function openModal() {
  if (!modalOverlay) return;

  // Remember previously focused element to restore later
  lastFocusedElement = document.activeElement;
  isModalOpen = true;

  modalOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");

  const focusableSelectors =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const focusable = modalOverlay.querySelectorAll(focusableSelectors);
  if (focusable.length > 0) {
    focusable[0].focus();
  }
}

// Close modal and restore focus to where the user was
function closeModal() {
  if (!modalOverlay) return;
  modalOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");

  if (modalContent) {
    modalContent.innerHTML = "";
  }

  isModalOpen = false;

  if (lastFocusedElement && document.contains(lastFocusedElement)) {
    lastFocusedElement.focus();
  }
}

// Allow closing the modal by clicking on the background overlay
if (modalOverlay) {
  modalOverlay.addEventListener("click", (event) => {
    if (event.target === modalOverlay) {
      closeModal();
    }
  });
}

// Close modal with the dedicated close button
if (modalCloseBtn) {
  modalCloseBtn.addEventListener("click", () => {
    closeModal();
  });
}

// Global keyboard handler: Escape to close, Tab to trap focus
document.addEventListener("keydown", (event) => {
  if (!isModalOpen || !modalOverlay) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeModal();
    return;
  }

  if (event.key === "Tab") {
    const focusableSelectors =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusable = modalOverlay.querySelectorAll(focusableSelectors);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Loop focus within modal when Tab/Shift+Tab reach ends
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
});

// ----- ☰ Search: toggle search panel -------------------------------------

// Collapse/expand the search panel for users who want more space
if (toggleStatusBtn && searchPanel) {
  toggleStatusBtn.addEventListener("click", () => {
    const isCollapsed = searchPanel.classList.toggle("collapsed");
    const expanded = !isCollapsed;
    toggleStatusBtn.setAttribute("aria-expanded", expanded ? "true" : "false");

    // Focus the input when the panel is opened
    if (expanded && ingredientsInput) {
      setTimeout(() => {
        ingredientsInput.focus();
      }, 250);
    }
  });
}

// ----- Random ingredient suggestion --------------------------------------

// Pick N random ingredients from the pool without replacement
function pickRandomIngredients(count) {
  const pool = [...RANDOM_INGREDIENTS_POOL];
  const chosen = [];

  for (let i = 0; i < count; i++) {
    if (!pool.length) break;
    const index = Math.floor(Math.random() * pool.length);
    const [ingredient] = pool.splice(index, 1);
    chosen.push(ingredient);
  }
  return chosen;
}

// Build a short string like "chicken, tomato"
function buildRandomIngredientSuggestion() {
  const howMany = 2;
  const picked = pickRandomIngredients(howMany);
  return picked.join(", ");
}

// ----- Rendering ---------------------------------------------------------

// Render the currently filtered/sorted recipes into cards
function renderRecipes() {
  if (!resultsGrid) return;
  clearResults();

  // Initial state: show a friendly empty message before any successful search
  if (!allRecipes.length && !lastQueryText) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No ideas yet. Start by adding a few ingredients above ✨";
    resultsGrid.appendChild(empty);
    updateSummary(0);
    return;
  }

  // Begin from full recipe list
  let working = [...allRecipes];

  // Favorites-only filter
  if (favoritesOnlyCheckbox && favoritesOnlyCheckbox.checked) {
    working = working.filter((recipe) => isFavorite(recipe.id));
  }

  // Quick-meal-only filter
  if (fastOnlyCheckbox && fastOnlyCheckbox.checked) {
    working = working.filter((recipe) => recipe.isQuick);
  }

  // Client-side sorting by name/time
  if (sortSelect) {
    const mode = sortSelect.value;

    if (mode === "name-az") {
      working.sort((a, b) => a.name.localeCompare(b.name));
    } else if (mode === "name-za") {
      working.sort((a, b) => b.name.localeCompare(a.name));
    } else if (mode === "time-asc") {
      working.sort((a, b) => a.minutes - b.minutes);
    } else if (mode === "time-desc") {
      working.sort((a, b) => b.minutes - a.minutes);
    }
  }

  // Nothing left after filters → show a helpful message
  if (!working.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent =
      "Nothing matches these filters yet — try relaxing one of the options above.";
    resultsGrid.appendChild(empty);
    updateSummary(0);
    return;
  }

  // Build a grid card for each recipe
  working.forEach((recipe) => {
    // Semantic container for a single recipe
    const card = document.createElement("article");
    card.className = "recipe-card";

    // Main interactive area that opens details
    const mainButton = document.createElement("button");
    mainButton.type = "button";
    mainButton.className = "recipe-card-main";
    mainButton.setAttribute("aria-label", `View details for ${recipe.name}`);

    const img = document.createElement("img");
    img.src = recipe.thumbnail;
    img.alt = `Photo of ${recipe.name}`;
    img.loading = "lazy";
    img.className = "recipe-thumb";

    const body = document.createElement("div");
    body.className = "recipe-body";

    const title = document.createElement("h3");
    title.className = "recipe-title";
    title.textContent = recipe.name;

    const metaRow = document.createElement("div");
    metaRow.className = "recipe-meta-row";

    const timeBadge = document.createElement("span");
    timeBadge.className = "badge badge-time";
    timeBadge.textContent = `${recipe.minutes} min`;
    metaRow.appendChild(timeBadge);

    if (recipe.isQuick) {
      const quickBadge = document.createElement("span");
      quickBadge.className = "badge badge-quick";
      quickBadge.textContent = "Quick (≤ 20 min)";
      metaRow.appendChild(quickBadge);
    }

    const hint = document.createElement("p");
    hint.className = "recipe-hint";
    hint.textContent = "View full recipe details";
    const arrow = document.createElement("span");
    arrow.className = "recipe-hint-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "→";
    hint.appendChild(arrow);

    body.appendChild(title);
    body.appendChild(metaRow);
    body.appendChild(hint);

    mainButton.appendChild(img);
    mainButton.appendChild(body);

    // Run details view when clicking the main button
    mainButton.addEventListener("click", () => {
      openRecipeDetails(recipe.id);
    });

    // Favorite button lives next to the main button inside the card
    const favoriteBtn = buildFavoriteButton(recipe.id);

    card.appendChild(mainButton);
    card.appendChild(favoriteBtn);

    resultsGrid.appendChild(card);
  });

  updateSummary(working.length);
}

// ----- Singular → plural normalization (simple) --------------------------

// Normalize ingredient words so "tomato" and "tomatoes" map together
function normalizeIngredient(word) {
  const lower = word.toLowerCase().trim();

  if (NO_PLURAL_CHANGE.has(lower)) {
    return lower;
  }

  if (lower === "potato") return "potatoes";
  if (lower === "tomato") return "tomatoes";

  return lower;
}

// ----- API calls ---------------------------------------------------------

// Multi-ingredient search using TheMealDB filter endpoint.
// It finds recipes that contain *all* entered ingredients.
async function searchRecipes(ingredientsRaw) {
  const trimmed = ingredientsRaw.trim();

  // Basic input validation: require at least one non-empty ingredient
  if (!trimmed) {
    setStatus("Pop in at least one ingredient to get started.", "error");
    allRecipes = [];
    renderRecipes();
    return;
  }

  const ingredientList = trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (!ingredientList.length) {
    setStatus("Try adding at least one ingredient (separated by commas).", "error");
    allRecipes = [];
    renderRecipes();
    return;
  }

  const normalizedIngredients = ingredientList.map(normalizeIngredient);

  // Basic offline check to provide a more helpful error
  if (!navigator.onLine) {
    setStatus(
      "You're offline. Please check your internet connection and try again.",
      "error"
    );
    allRecipes = [];
    renderRecipes();
    return;
  }

  // For the summary chip, use the user's original terms
  lastQueryText = ingredientList.join(", ");

  showLoading();
  setStatus("Let me look for ideas that use those together…", "info");

  try {
    // 1. Fetch recipe ID lists for each ingredient separately
    const idLists = await Promise.all(
      normalizedIngredients.map(async (ingredient) => {
        const url = `https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(
          ingredient
        )}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Filter API response was not OK (${response.status})`);
        }
        const data = await response.json();

        if (!data.meals || !data.meals.length) {
          return [];
        }

        return data.meals.map((meal) => meal.idMeal);
      })
    );

    // If any ingredient returns zero meals, there is no common recipe
    if (idLists.some((list) => list.length === 0)) {
      allRecipes = [];
      setStatus(
        "I couldn't find anything with all of those together — try removing one or two.",
        "info"
      );
      renderRecipes();
      return;
    }

    // 2. Intersect all ID lists to find recipes containing every ingredient
    const intersection = idLists.reduce((acc, current) =>
      acc.filter((id) => current.includes(id))
    );

    if (!intersection.length) {
      allRecipes = [];
      setStatus(
        "I couldn't find anything with all of those together — try removing one or two.",
        "info"
      );
      renderRecipes();
      return;
    }

    // 3. Fetch the list of meals for the first ingredient,
    //    then filter down to the intersection of IDs
    const firstIngredientNormalized = normalizedIngredients[0];
    const mainUrl = `https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(
      firstIngredientNormalized
    )}`;
    const mainResponse = await fetch(mainUrl);
    if (!mainResponse.ok) {
      throw new Error(`Filter API response was not OK (${mainResponse.status})`);
    }
    const mainData = await mainResponse.json();
    const mainMeals = mainData.meals || [];

    const filteredMeals = mainMeals.filter((meal) =>
      intersection.includes(meal.idMeal)
    );

    if (!filteredMeals.length) {
      allRecipes = [];
      setStatus(
        "I couldn't find anything with all of those together — try removing one or two.",
        "info"
      );
      renderRecipes();
      return;
    }

    // 4. Map raw meal objects into our internal recipe shape
    allRecipes = filteredMeals.map((meal) => {
      const minutes = estimateMinutesFromName(meal.strMeal);
      return {
        id: meal.idMeal,
        name: meal.strMeal,
        thumbnail: meal.strMealThumb,
        minutes,
        isQuick: isQuickMeal(minutes)
      };
    });

    setStatus(
      `Here are ${allRecipes.length} ideas you can make with those ingredients.`,
      "info"
    );
    renderRecipes();
  } catch (error) {
    console.error(error);
    setStatus(
      "Something went wrong while fetching recipes. Please try again in a moment.",
      "error"
    );
    allRecipes = [];
    renderRecipes();
  } finally {
    hideLoading();
  }
}

// Fetch full recipe details for a given ID and render inside the modal
async function openRecipeDetails(id) {
  if (!modalContent) return;

  openModal();
  modalContent.innerHTML = '<p class="modal-loading">Loading recipe details…</p>';

  const detailUrl = `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(
    id
  )}`;

  try {
    const response = await fetch(detailUrl);
    if (!response.ok) {
      throw new Error(`Detail API response was not OK (${response.status})`);
    }

    const data = await response.json();
    if (!data.meals || !data.meals.length) {
      modalContent.innerHTML =
        '<p class="modal-error">Could not find more details for this recipe.</p>';
      return;
    }

    const meal = data.meals[0];

    // Reuse the estimate from the list if available for consistency
    const fromList = allRecipes.find((r) => r.id === id);
    const minutes = fromList
      ? fromList.minutes
      : estimateMinutesFromName(meal.strMeal || "");

    // Build ingredients list using array methods
    const ingredients = Array.from({ length: 20 }, (_, index) => {
      const ingredient = meal[`strIngredient${index + 1}`];
      const measure = meal[`strMeasure${index + 1}`];
      if (ingredient && ingredient.trim()) {
        const ingredientText = ingredient.trim();
        const measureText = measure && measure.trim() ? ` – ${measure.trim()}` : "";
        return `${ingredientText}${measureText}`;
      }
      return null;
    }).filter(Boolean);

    const ingredientsHtml = ingredients
      .map((entry) => `<li>${entry}</li>`)
      .join("");

    const subtitleParts = [meal.strArea, meal.strCategory].filter(Boolean);
    const subtitle = subtitleParts.join(" · ");

    const quickBadgeHtml = isQuickMeal(minutes)
      ? '<span class="badge badge-quick">Quick (≤ 20 min)</span>'
      : "";

    const sourceHtml = meal.strSource
      ? `<p class="modal-subtitle">Source: <a href="${meal.strSource}" target="_blank" rel="noreferrer">${meal.strSource}</a></p>`
      : "";

    const rawInstructions =
      meal.strInstructions || "No instructions provided.";
    const cleanedInstructions = rawInstructions
      .replace(/^\s+/gm, "")
      .trim();

    modalContent.innerHTML = `
      <div class="modal-body">
        <h2 id="modal-title" class="modal-title">${meal.strMeal}</h2>
        ${
          subtitle
            ? `<p class="modal-subtitle">${subtitle}</p>`
            : ""
        }
        <div class="recipe-meta-row">
          <span class="badge badge-time">${minutes} min</span>
          ${quickBadgeHtml}
        </div>
        <h3 class="modal-section-title">Ingredients</h3>
        <ul class="ingredients-list">
          ${ingredientsHtml}
        </ul>
        <h3 class="modal-section-title">Instructions</h3>
        <p class="instructions">${cleanedInstructions}</p>
        ${sourceHtml}
      </div>
    `;
  } catch (error) {
    console.error(error);
    modalContent.innerHTML =
      '<p class="modal-error">Something went wrong while loading this recipe. Please try again.</p>';
  }
}

// ----- Event wiring & initial setup --------------------------------------

// Auto-focus the ingredient input on load if the search panel is open
if (ingredientsInput && searchPanel && !searchPanel.classList.contains("collapsed")) {
  ingredientsInput.focus();
}

// Handle main form submit → trigger search by ingredients
if (form) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!ingredientsInput) return;
    searchRecipes(ingredientsInput.value);
  });
}

// Random ingredient button → fill input and run search immediately
if (randomBtn && ingredientsInput) {
  randomBtn.addEventListener("click", () => {
    const suggestion = buildRandomIngredientSuggestion();
    ingredientsInput.value = suggestion;
    setStatus("Trying a random combo…", "info");
    searchRecipes(suggestion);
  });
}

// Simple client-side re-sorting & filtering
if (sortSelect) {
  sortSelect.addEventListener("change", () => {
    renderRecipes();
  });
}

if (fastOnlyCheckbox) {
  fastOnlyCheckbox.addEventListener("change", () => {
    renderRecipes();
  });
}

if (favoritesOnlyCheckbox) {
  favoritesOnlyCheckbox.addEventListener("change", () => {
    renderRecipes();
  });
}

// Initialize global UI state
initContrastMode();
loadFavorites();
renderRecipes();
setStatus("Start by adding a couple of ingredients above ✨", "info");