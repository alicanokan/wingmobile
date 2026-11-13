# Dataset feathers pipeline

How the feathers in `public/feathers/dataset/` were made. Credits and licences are in
`public/feathers/dataset/LICENSE.md`. FeathersV1 and the Kaggle set are **non-commercial only**; the Feather Atlas is free to use.

1. Download the source images into a folder outside the repo (`DATASET_ROOT`):
   - FeathersV1 (https://github.com/feathers-dataset/feathersv1-dataset): put the files named in
     `spec.json` (`"original"`) into `DATASET_ROOT/feathersv1/`. They live under
     `images/<order>/<genus_species>/` in that repository.
   - USFWS Feather Atlas (https://www.fws.gov/lab/featheratlas/): scans are at
     `https://www.fws.gov/lab/featheratlas/images/feathers/<original>`; put them in
     `DATASET_ROOT/featheratlas/`. The site's catalogue (species, feather lengths, pattern and
     colour tags) is the SQLite file `data/featheratlas.sqlite` on the same site.
   - Kaggle Feather Dataset (https://www.kaggle.com/datasets/ardamavi/feather-dataset): unzip so the
     photos are in `DATASET_ROOT/kaggle/Feather_Dataset/`.
2. `python3 -I scripts/feather-datasets/cutout.py scripts/feather-datasets/spec.json OUT DATASET_ROOT`
3. Look at every result, then copy `OUT/full/fv1-x.png` → `public/feathers/dataset/x.png` and
   `OUT/thumbs/fv1-x.png` → `public/feathers/thumbs/dataset/x.png` (drop the `fv1-`/`kg-`/`fa-` prefix).
4. Add or update the entry in `src/sim/datasetFeathers.ts` and the tables in `LICENSE.md`.

`spec.json` per feather: `box` = optional crop rectangle (fractions of the photo) handed to GrabCut;
`rect: false` = segment from a colour threshold around `seed` instead of a rectangle; `sheet` =
photo of a whole sheet with uneven light (Kaggle); `pick` = which feather of a Feather Atlas scan to
take, counted from the left from 0 (the box is found automatically and the chart grid is erased).
