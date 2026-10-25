"""Fetch the IGN's current data, rebuild every file the site draws from it, and load them into the running site.

    python data/update_data.py      # needs numpy and the site running in Docker (tester-le-site/demarrer-*)

Without Python, tester-le-site/mettre-a-jour-donnees-* run it in a container, then load the files.

Then review the changes to data/*.geojson (the script prints them) and commit them.
"""

import shutil
import subprocess

import download_tiles
import prepare_basin
import prepare_layers
from prepare_basin import DATA, RAW

IMPORT = [
    "docker", "compose", "exec", "-T", "backend", "python", "manage.py", "import_geodata",
    "--basin", "/data/basin.geojson", "--watercourses", "/data/watercourses.geojson", "--springs", "/data/springs.geojson",
]


def main():
    # The preparation scripts keep their downloads in data/raw/; clear it so this run gets the IGN's current data.
    shutil.rmtree(RAW, ignore_errors=True)
    print("1/4 Contour du bassin versant (relief IGN)...", flush=True)
    prepare_basin.main()
    print("2/4 Cours d'eau et sources (BD TOPAGE, BD TOPO)...", flush=True)
    prepare_layers.main()
    # Tiles already on disk are kept: delete data/tiles/ to fetch a newer Plan IGN.
    print("3/4 Fond de carte...", flush=True)
    download_tiles.main()
    if not shutil.which("docker"):
        # Run inside a container by the testers' scripts, which load the files into the site themselves.
        return
    print("4/4 Chargement dans le site...", flush=True)
    if subprocess.run(IMPORT, cwd=DATA.parent).returncode != 0:
        print("   Le site ne tourne pas : lancez-le, puis relancez ce script (les fichiers sont déjà à jour).")
        return
    print("\nFichiers modifiés (à relire puis commiter) :")
    subprocess.run(["git", "diff", "--stat", "--", "data"], cwd=DATA.parent)


if __name__ == "__main__":
    main()
