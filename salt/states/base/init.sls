freshcrate-base-dirs:
  file.directory:
    - names:
      - /opt/freshcrate
      - /opt/freshcrate/home
      - /opt/freshcrate/workspace
      - /opt/freshcrate/home/receipts
    - user: root
    - group: root
    - mode: '0755'

freshcrate-salt-marker:
  file.managed:
    - name: /opt/freshcrate/home/receipts/salt-base-applied.txt
    - contents: |
        state=base
        managed_by=salt-call-local
