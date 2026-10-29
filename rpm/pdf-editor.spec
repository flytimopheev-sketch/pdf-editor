Name:           pdf-editor
Version:        2.0.0
Release:        1%{?dist}
Summary:        Редактор PDF — редактор PDF-документов для РЕД ОС
License:        MIT
URL:            https://github.com/flytimopheev-sketch/pdf-editor
Source0:        %{name}-%{version}.tar.gz
BuildArch:      x86_64
AutoReqProv:    no
Requires:       glibc

%define _binary_payload w9.gzdio

%description
Настольный редактор PDF-документов (Electron).
Слои изменений с отменой действий, текст и подписи,
поворот и обрезка страниц, экспорт в Word и Excel,
сравнение двух документов, автосохранение сессии.

%prep
%setup -q

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}/opt/pdf-editor
cp -r app %{buildroot}/opt/pdf-editor/app
cp -r electron %{buildroot}/opt/pdf-editor/electron
cp -r icons %{buildroot}/opt/pdf-editor/icons
install -m 755 run.sh       %{buildroot}/opt/pdf-editor/run.sh
install -m 755 install.sh   %{buildroot}/opt/pdf-editor/install.sh
install -m 755 uninstall.sh %{buildroot}/opt/pdf-editor/uninstall.sh

# Иконки всех размеров (красивый ярлык в меню)
for size in 16 24 32 48 64 128 256 512; do
  mkdir -p %{buildroot}/usr/share/icons/hicolor/${size}x${size}/apps
  install -m 644 icons/pdf-editor-${size}.png \
    %{buildroot}/usr/share/icons/hicolor/${size}x${size}/apps/pdf-editor.png
done

# Ярлык в меню приложений
mkdir -p %{buildroot}/usr/share/applications
cat > %{buildroot}/usr/share/applications/pdf-editor.desktop << 'EOF'
[Desktop Entry]
Name=Редактор PDF
GenericName=Редактор PDF-документов
Comment=Редактирование PDF: слои, текст, подписи, OCR
Exec=/opt/pdf-editor/run.sh
Icon=pdf-editor
Terminal=false
Type=Application
Categories=Office;Graphics;Viewer;
StartupNotify=true
EOF

%post
update-desktop-database /usr/share/applications 2>/dev/null || :
gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || :

%files
/opt/pdf-editor
/usr/share/applications/pdf-editor.desktop
/usr/share/icons/hicolor/*/apps/pdf-editor.png
# SUID-помощник Chrome sandbox обязателен для Electron
%attr(4755,root,root) /opt/pdf-editor/electron/electron/chrome-sandbox
