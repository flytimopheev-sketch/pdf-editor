Name:           pdf-editor
Version:        1.0.0
Release:        1%{?dist}
Summary:        Редактор PDF — графический редактор PDF файлов
License:        MIT
URL:            http://localhost:3000
Source0:        pdf-editor-%{version}.tar.gz
BuildArch:      x86_64
Requires:       glibc
AutoReqProv:    no

%description
Графический веб-редактор PDF файлов для РЕД ОС.
Поддерживает открытие, вращение, добавление текста,
выделение и копирование фрагментов, сжатие PDF.

%prep
%setup -q

%install
mkdir -p %{buildroot}/opt/pdf-editor
cp -r app %{buildroot}/opt/pdf-editor/
cp -r node %{buildroot}/opt/pdf-editor/
cp -r bin %{buildroot}/opt/pdf-editor/

mkdir -p %{buildroot}/etc/systemd/system
cat > %{buildroot}/etc/systemd/system/pdf-editor.service << 'EOF'
[Unit]
Description=Редактор PDF
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pdf-editor/app
Environment=NODE_PATH=/opt/pdf-editor/app/node_modules
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=/opt/pdf-editor/node/bin/node /opt/pdf-editor/app/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

mkdir -p %{buildroot}/usr/share/applications
cat > %{buildroot}/usr/share/applications/pdf-editor.desktop << 'EOF'
[Desktop Entry]
Name=Редактор PDF
Comment=Графический редактор PDF файлов
Exec=xdg-open http://localhost:3000
Icon=text-editor
Terminal=false
Type=Application
Categories=Office;Graphics;
EOF

%files
/opt/pdf-editor
/etc/systemd/system/pdf-editor.service
/usr/share/applications/pdf-editor.desktop

%post
%systemd_post pdf-editor.service

%preun
%systemd_preun pdf-editor.service

%postun
%systemd_postun_with_restart pdf-editor.service
