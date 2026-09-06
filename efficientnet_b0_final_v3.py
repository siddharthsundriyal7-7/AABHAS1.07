"""
Rockfall AI — EfficientNet-B0 v3 training (Colab-ready)
--------------------------------------------------------
Trains a binary (high-risk / low-risk) rock-face classifier and saves a
plain PyTorch checkpoint: efficientnet_b0_final_v3.pth

NO ONNX EXPORT — this version only produces a .pth file, which your
api/classify.py can load directly with torchvision.

ASSUMPTIONS (adjust if these don't match your setup):
  - Dataset lives at /content/drive/MyDrive/dataset with two subfolders:
        dataset/high_risk/*.jpg
        dataset/low_risk/*.jpg
    (standard torchvision.datasets.ImageFolder layout)
  - Binary classification: class 0 = high_risk, class 1 = low_risk
    (ImageFolder sorts class names alphabetically, so double-check this
    against train_dataset.classes when you run it)
  - Batch size 32, 15 epochs, Adam optimizer — tune as needed.

Run this as-is in Google Colab. If running locally instead of Colab,
delete the `drive.mount(...)` block and point DATA_DIR at your local path.
"""

import os
import copy
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split
from torchvision import datasets, transforms, models

# ---------------------------------------------------------------------
# 1. Mount Google Drive (Colab only — remove this block if running locally)
# ---------------------------------------------------------------------
try:
    from google.colab import drive
    drive.mount('/content/drive')
except ImportError:
    pass  # not running in Colab

DATA_DIR = "/content/drive/MyDrive/dataset"
OUTPUT_PATH = "/content/drive/MyDrive/efficientnet_b0_final_v3.pth"

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
BATCH_SIZE = 32
NUM_EPOCHS = 15
LEARNING_RATE = 1e-4
VAL_SPLIT = 0.2

# ---------------------------------------------------------------------
# 2. Data loading + augmentation
# ---------------------------------------------------------------------
train_transforms = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.RandomHorizontalFlip(),
    transforms.RandomRotation(10),
    transforms.ColorJitter(brightness=0.2, contrast=0.2),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                          std=[0.229, 0.224, 0.225]),
])

val_transforms = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                          std=[0.229, 0.224, 0.225]),
])

full_dataset = datasets.ImageFolder(DATA_DIR, transform=train_transforms)
print("Classes (index -> label):", full_dataset.classes)

val_size = int(len(full_dataset) * VAL_SPLIT)
train_size = len(full_dataset) - val_size
train_dataset, val_dataset = random_split(full_dataset, [train_size, val_size])
val_dataset.dataset.transform = val_transforms  # no augmentation on val

train_loader = DataLoader(train_dataset, batch_size=BATCH_SIZE, shuffle=True, num_workers=2)
val_loader = DataLoader(val_dataset, batch_size=BATCH_SIZE, shuffle=False, num_workers=2)

# ---------------------------------------------------------------------
# 3. Model — EfficientNet-B0 with a fresh binary classification head
# ---------------------------------------------------------------------
model = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
num_features = model.classifier[1].in_features
model.classifier[1] = nn.Linear(num_features, 2)  # 2 classes: high/low risk
model = model.to(DEVICE)

criterion = nn.CrossEntropyLoss()
optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="max", patience=2, factor=0.5)

# ---------------------------------------------------------------------
# 4. Train / validate loop
# ---------------------------------------------------------------------
def run_epoch(loader, train: bool):
    model.train() if train else model.eval()
    total_loss, correct, total = 0.0, 0, 0

    torch.set_grad_enabled(train)
    for images, labels in loader:
        images, labels = images.to(DEVICE), labels.to(DEVICE)

        if train:
            optimizer.zero_grad()

        outputs = model(images)
        loss = criterion(outputs, labels)

        if train:
            loss.backward()
            optimizer.step()

        total_loss += loss.item() * images.size(0)
        preds = outputs.argmax(dim=1)
        correct += (preds == labels).sum().item()
        total += labels.size(0)

    return total_loss / total, correct / total


best_val_acc = 0.0
best_weights = copy.deepcopy(model.state_dict())

for epoch in range(1, NUM_EPOCHS + 1):
    train_loss, train_acc = run_epoch(train_loader, train=True)
    val_loss, val_acc = run_epoch(val_loader, train=False)
    scheduler.step(val_acc)

    print(f"Epoch {epoch:02d}/{NUM_EPOCHS} | "
          f"train_loss={train_loss:.4f} train_acc={train_acc:.4f} | "
          f"val_loss={val_loss:.4f} val_acc={val_acc:.4f}")

    if val_acc > best_val_acc:
        best_val_acc = val_acc
        best_weights = copy.deepcopy(model.state_dict())

print(f"\nBest validation accuracy: {best_val_acc:.4f}")

# ---------------------------------------------------------------------
# 5. Save checkpoint — .pth ONLY, no ONNX export
# ---------------------------------------------------------------------
model.load_state_dict(best_weights)

checkpoint = {
    "model_state_dict": model.state_dict(),
    "class_to_idx": full_dataset.class_to_idx,   # e.g. {'high_risk': 0, 'low_risk': 1}
    "num_classes": 2,
    "val_accuracy": best_val_acc,
    "architecture": "efficientnet_b0",
}

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
torch.save(checkpoint, OUTPUT_PATH)
print(f"Saved checkpoint to {OUTPUT_PATH}")
