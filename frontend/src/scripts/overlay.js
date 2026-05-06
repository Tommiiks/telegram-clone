/*
 * RICORDA DI AVERE NEL HTML:
 * <div class="loader-overlay" id="loaderOverlay">
 *     <div class="loader-spinner"> </div>
 * </div>
 * */

const loaderOverlay = document.getElementById("loaderOverlay");

function showOverlay(){
  loaderOverlay.classList.add("open");
}

function hideOverlay(){
  loaderOverlay.classList.remove("open");
}
